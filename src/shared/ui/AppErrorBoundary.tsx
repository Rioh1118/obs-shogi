import { Component, type ReactNode } from "react";

/**
 * 境界の名乗り。**名簿はこの1つ。**
 *
 * `label` に直値を書かせない理由は2つ。**同じ名乗りを2枚に振ると、どちらが受けたかを
 * 画面からもログからも特定できない**（内側の1枚を外しても外側が同じ画面で受けるので、
 * 退行が見えない）。もう1つは、綴りが `docs/spec/screens/app-layout.md` の
 * 「失敗の見せ方」の表と一致していることを機械で見るため ——
 * JSX から正規表現で拾う形にすると、`label={...}` と書いた瞬間に読み飛ばして
 * 次の境界の名乗りを拾う。`src/__tests__/errorBoundaryInventory.test.ts` が
 * この定数と表を突き合わせ、**1つの鍵を2箇所で使っていないこと**も見る。
 */
export const BOUNDARY_LABELS = {
  /** `App` の `.app-root` の内側。最後の砦 */
  root: "アプリ",
  /** `App` の `UpdaterScreen` を包む */
  updater: "更新の知らせ",
  /** `RuntimeShell` の `.app-content` の内側 */
  shell: "作業画面",
  /** `ModalLayerContent` を包む */
  modal: "モーダル",
  /** 盤ペインを包む */
  board: "盤",
  /** `KifuStreamList` を包む */
  kifuStream: "棋譜一覧",
  /** 解析ペインを包む */
  analysis: "解析",
} as const;

export type BoundaryLabel = (typeof BOUNDARY_LABELS)[keyof typeof BOUNDARY_LABELS];

/**
 * 捕まえた例外と、畳みを解く手段。**`fallback` に渡すのはこれだけ。**
 *
 * 案内・出口・置き方（流れの中／浮かせる／ウィンドウ枠ごと）は fallback 側の持ち物で、
 * 境界は関与しない。境界が表示の欄を持つと、増えるたびに fallback への転送を
 * 書き足すことになり、**書き忘れても型でも lint でも赤くならない。**
 */
export type ErrorBoundaryView = {
  /** 畳まれた範囲の名前。`AppErrorBoundary` の `label` と同じもの */
  label: BoundaryLabel;
  /** 投げられた値。`Error` とは限らない */
  error: unknown;
  /** 畳むのをやめて描き直す。原因が境界の外にあるなら効かない */
  reset: () => void;
};

type Props = {
  /**
   * 畳まれる範囲の名前。**名簿（`BOUNDARY_LABELS`）から選ぶ。**
   *
   * 落ちたときの `console.error` の頭にも付くので、ログだけを見て
   * どの境界が受けたかが分かる。
   */
  label: BoundaryLabel;
  /**
   * これが変わったら畳むのをやめる。**落ちた原因が境界の外にある**ときの唯一の出口。
   *
   * `reset` は `error` を消すだけなので、原因が上位の state に残っていれば同じ行で
   * 落ち直し、画面は1ドットも変わらない。逆に、原因が消えても（別の棋譜を選んだ、
   * モーダルを閉じた）境界は畳んだままになる。**どちらも利用者からは「壊れたまま」に見える。**
   *
   * 渡すのは「別の局面／別の画面になった」と言い切れる値だけにする。毎レンダ変わる値を
   * 渡すと、落ち続けるものを描き直し続けて**例外がこの境界を素通りする**（fallback が
   * 出ないだけでは済まない）。
   */
  resetKeys?: readonly unknown[];
  /**
   * 畳んだ間に描くもの。**必須。**
   *
   * 既定を持たせない —— 持たせると、置き方（流れの中に出すのか、浮かせるのか、
   * ウィンドウ枠ごと差し替えるのか）を選ばずに境界を置けてしまう。**選び損ねた事故は
   * 落ちるまで出ない。**
   *
   * **ここで描くものは境界の内側に居る。** 投げれば同じ境界では捕まらず、1つ外の境界まで
   * 抜ける。落ちたツリーの部品（`TitleBar` など）を再利用しないこと —— 同じ例外で
   * この画面も落ちる。
   */
  fallback: (view: ErrorBoundaryView) => ReactNode;
  children: ReactNode;
};

type State = {
  /**
   * 捕まえたかどうか。**投げられた値そのもので判定しない。**
   *
   * `throw` される値は `Error` とは限らず、`undefined` / `null` / `""` / `0` / `false` もありうる。
   * 値を旗に兼ねると falsy な例外で `render` が `children` を描き直し、React はそれを
   * 「境界が処理できなかった」と見なして1つ外へ流す。境界は全部この class なので、
   * **入れ子の何枚目でも同じ経路で素通りし、root ごと unmount する** ——
   * この部品が消しに来た状態そのものになる。
   */
  caught: boolean;
  /** 投げられた値。`caught` が偽のときは見ない */
  error: unknown;
  /** 直前に見た `resetKeys`。`getDerivedStateFromProps` は前の props を受け取れない */
  keys: readonly unknown[];
};

/**
 * レンダ例外を受けて、囲った範囲だけを畳む。
 *
 * **持つのは「捕まえたか」と「畳みを解く鍵」だけ。** 何をどう見せるかは `fallback` が決める。
 * どこに何枚あるか・どこまで枠が残るかは `docs/spec/screens/app-layout.md` の
 * 「失敗の見せ方」が持つ。**ここに写さない** —— 2箇所に置くと片方だけ直る。
 */
export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { caught: false, error: null, keys: props.resetKeys ?? [] };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { caught: true, error };
  }

  /**
   * 鍵が変わったら畳むのをやめる。
   *
   * **鍵は落ちている間も更新する。** 更新しないと、比較の相手が落ちた時点の鍵に留まったまま
   * 毎レンダ「変わった」と判定され、`error` を消しては子を描き直し続ける。境界は捕まえ直せず、
   * 例外は1つ外の境界（無ければ root）まで抜ける。
   */
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    const keys = props.resetKeys ?? [];
    const same =
      keys.length === state.keys.length && keys.every((key, at) => Object.is(key, state.keys[at]));
    if (same) return null;
    return { caught: false, error: null, keys };
  }

  // 落ちた原因はここでしか見られない。表示側は詳細を出さない
  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error(
      `[AppErrorBoundary:${this.props.label}] Uncaught error:`,
      error,
      info.componentStack,
    );
  }

  reset = () => {
    this.setState({ caught: false, error: null });
  };

  render() {
    if (!this.state.caught) return this.props.children;
    return this.props.fallback({
      label: this.props.label,
      error: this.state.error,
      reset: this.reset,
    });
  }
}

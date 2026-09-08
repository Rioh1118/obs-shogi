import { Component, type ReactNode } from "react";
import "./AppErrorBoundary.scss";

type Props = {
  /**
   * 畳まれる範囲の名前。「盤」「解析」のように**利用者が画面で指せる呼び方**にする。
   *
   * **必須にしてある。** 境界は入れ子で置くので、どれが受けても同じ文言だと、
   * 内側の1枚を外しても外側が同じ画面で受けて退行が見えない。
   */
  label: string;
  /**
   * これが変わったら `error` を落とす。**落ちた原因が境界の外にある**ときの唯一の出口。
   *
   * `reset` は `error` を消すだけなので、原因が上位の state に残っていれば同じ行で
   * 落ち直し、画面は1ドットも変わらない。逆に、原因が消えても（別の棋譜を選んだ、
   * モーダルを閉じた）境界は畳んだままになる。**どちらも利用者からは「壊れたまま」に見える。**
   *
   * 渡すのは「別の局面／別の画面になった」と言い切れる値だけにする。毎レンダ変わる値を
   * 渡すと、落ち続けるものを描き続けようとして fallback が出なくなる。
   */
  resetKeys?: readonly unknown[];
  /**
   * 平常時に in-flow の箱を作らない部品を包む境界で真にする。詳細は SCSS の `--floating`。
   *
   * **境界の位置の性質なので、境界が持つ。** `fallback` を渡して既定の本文を組み直す形にすると、
   * 本文に段が増えたときに組み直した側だけが古いまま残る。
   */
  floating?: boolean;
  /**
   * 次に何をすればよいか。**畳まれた範囲ごとに違う**ので、置く側が決める。
   *
   * `再表示` は境界の `error` を消すだけで、原因が境界の外にあれば同じ行で落ち直す。
   * ここが無いと、押しても変わらないボタン1つだけが残る行き止まりになる。
   */
  hint?: ReactNode;
  children: ReactNode;
  /**
   * 既定の画面の代わりに描くもの。渡さなければ `AppErrorFallbackBody` が出る。
   *
   * **ここで描くものは境界の内側に居る。** 投げれば同じ境界では捕まらず、1つ外の境界まで
   * 抜ける。落ちたツリーの部品（`TitleBar` など）を再利用しないこと —— 同じ例外で
   * この画面も落ちる。
   *
   * `reset` は `error` を消すだけ。原因が境界の外にあるなら効かない（`resetKeys` を見ること）。
   *
   * **`label` を受け取って使うこと。** ここで名乗りを書き直すと、ログ（`componentDidCatch`）と
   * 画面が別々の文字列を持ち、`label` を直しても画面が変わらなくなる。
   */
  fallback?: (args: { error: unknown; reset: () => void; label: string }) => ReactNode;
};

type State = {
  /**
   * 捕まえたかどうか。**投げられた値そのもので判定しない。**
   *
   * `throw` される値は `Error` とは限らず、`undefined` / `null` / `""` / `0` / `false` もありうる。
   * 値を旗に兼ねると falsy な例外で `render` が `children` を描き直し、React はそれを
   * 「境界が処理できなかった」と見なして1つ外へ流す。境界は全部この class なので、
   * **7枚とも素通りして root ごと unmount する** —— この部品が消しに来た状態そのものになる。
   */
  caught: boolean;
  /** 投げられた値。`caught` が偽のときは見ない */
  error: unknown;
  /** 直前に見た `resetKeys`。`getDerivedStateFromProps` は前の props を受け取れない */
  keys: readonly unknown[];
};

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
   * **鍵は落ちている間も更新する。** 落ちたまま鍵だけ2回動くと、比較の相手が
   * 落ちた時点の鍵に留まり、1回目の変化で解けた後に2回目で解け直せなくなる。
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
    const { caught, error } = this.state;
    if (caught) {
      if (this.props.fallback) {
        return this.props.fallback({ error, reset: this.reset, label: this.props.label });
      }
      return (
        <AppErrorFallbackBody
          label={this.props.label}
          error={error}
          reset={this.reset}
          floating={this.props.floating}
          hint={this.props.hint}
        />
      );
    }
    return this.props.children;
  }
}

/**
 * 落ちたことを伝える本文。**出典はここ1つ。**
 *
 * 既定の fallback と、枠を自前で持つ `fallback`（`app/RootErrorFallback.tsx`）の両方が描く。
 * 写しを持たせると、文言を直したときに片方だけが変わり、その片方を見ているテストだけが赤くなる。
 */
export function AppErrorFallbackBody({
  label,
  error,
  reset,
  floating = false,
  hint,
  actions,
  notice,
}: {
  /** 畳まれた範囲の名前。`AppErrorBoundary` の `label` と同じもの */
  label: string;
  /**
   * 落ちた原因。**画面に出す唯一の場所。**
   *
   * `console.error` は配布版では誰も読めない（`devtools` の feature を入れておらず、
   * フロントの `console` をログファイルへ流す経路も無い）。ここで捨てると、
   * 利用者が報告できるのは「表示できませんでした」の一文だけになる。
   */
  error: unknown;
  reset: () => void;
  /** 平常時に in-flow の箱を作らない部品を包む境界で真にする。詳細は SCSS の `--floating` */
  floating?: boolean;
  /** 次に何をすればよいか。**畳まれた範囲ごとに違う**ので、置く側が決める */
  hint?: ReactNode;
  /** 出口を押したあとに起きたことの知らせ。**出口の下に流れで置く**（重ねると出口を覆う） */
  notice?: ReactNode;
  /**
   * 「再表示」の隣に並べる出口。**再表示で戻らなかったとき**に使うものを渡す。
   *
   * `children` にしないのは、同じファイルの `AppErrorBoundary` の `children`（囲う対象）と
   * 逆の意味になるため。`AppErrorFallbackAction` を並べること
   */
  actions?: ReactNode;
}) {
  // `throw` される値は `Error` とは限らない。**`String()` で落とさない** ——
  // plain object を投げると `[object Object]` がそのまま画面に出て、
  // 案内（`hint`）より目立つ位置に意味の無い1行が入る
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  return (
    <div className={`app-error-fallback${floating ? " app-error-fallback--floating" : ""}`}>
      <p>{label}を表示できませんでした。</p>
      {/*
        **これは報告用の材料で、利用者向けの説明ではない。** レンダ経路で実際に投げられるのは
        `plan walk overflows` のような開発者向けの英語なので、見出しを添えて役割を割る。
        次に何をすればよいかは `hint` が持つ
      */}
      {detail && <p className="app-error-fallback__detail">技術的な内容: {detail}</p>}
      {hint && <p className="app-error-fallback__hint">{hint}</p>}
      <div className="app-error-fallback__actions">
        <AppErrorFallbackAction onClick={reset}>再表示</AppErrorFallbackAction>
        {actions}
      </div>
      {notice}
    </div>
  );
}

/**
 * 落ちた画面に並べるボタン。**class 名は `shared/ui` の中に閉じる。**
 *
 * 呼び出し側に綴りを書かせると、`shared` 側で class を整理したときに黙って素の `<button>` へ戻る。
 * 落ちる場所は「最後の砦」の画面なので、型でも lint でもテストでも赤くならない。
 */
export function AppErrorFallbackAction({
  onClick,
  /** 「再表示」で戻らなかったときの出口。同じ強さで並べると、先に試すべき方が読めなくなる */
  secondary = false,
  children,
}: {
  onClick: () => void;
  secondary?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`app-error-fallback__action${secondary ? " app-error-fallback__action--secondary" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

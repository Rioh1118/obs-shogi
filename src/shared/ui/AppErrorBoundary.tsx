import { Component, type CSSProperties, type ReactNode } from "react";
import "./AppErrorBoundary.scss";

/**
 * 畳むのをやめる出口の文言。**出典はここ1つ。**
 *
 * 各境界の `hint` がこの綴りを本文に埋めるので（「…してから『再表示』を押してください。」）、
 * 手書きにすると、ボタンを改名したときに案内が**存在しないボタン**を名指しする。
 */
export const RETRY_LABEL = "再表示";

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
   * 渡すと、落ち続けるものを描き直し続けて**例外がこの境界を素通りする**（fallback が
   * 出ないだけでは済まない）。
   */
  resetKeys?: readonly unknown[];
  /**
   * 平常時に in-flow の箱を作らない部品を包む境界で渡す。詳細は SCSS の `--floating`。
   *
   * **値は段の番号。** 浮かせた枠は同時に2枚以上出うるので、**同じ番号を2箇所に振らない**
   * （同じ座標に重なって、後から描かれた側が下の1枚を丸ごと覆う）。0 から詰めて振ること。
   *
   * **境界の位置の性質なので、境界が持つ。** `fallback` を渡して既定の本文を組み直す形にすると、
   * 本文に段が増えたときに組み直した側だけが古いまま残る。
   */
  floatingSlot?: number;
  /**
   * 次に何をすればよいか。**畳まれた範囲ごとに違う**ので、置く側が決める。
   *
   * `再表示` は境界の `error` を消すだけで、原因が境界の外にあれば同じ行で落ち直す。
   * ここが無いと、押しても変わらないボタン1つだけが残る行き止まりになる。
   */
  hint?: ReactNode;
  /** 「再表示」の隣に並べる出口。落ちる前から決まっている表現なので、境界が持てる */
  extraActions?: ReactNode;
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
   * **受け取った `AppErrorFallbackProps` を丸ごと `AppErrorFallbackBody` へ渡すこと。**
   * 欄を手で選び直すと、境界に書いたものが黙って捨てられる。型を1つにしてあるので、
   * スプレッドで渡していれば欄が増えても落とさない。
   *
   * **`afterAction` だけは境界から渡らない。**「出口を押した結果」に依存していて、
   * その state は fallback の中にしか無い（`RootErrorFallback` の `closeFailed`）。
   * 境界が持てるのは、落ちる前から決まっている表現だけ。
   */
  fallback?: (view: AppErrorFallbackProps) => ReactNode;
};

/**
 * 落ちたことを伝える本文が要るもの。**境界が組んで渡す。**
 *
 * `fallback` を書く人はこれを丸ごと `AppErrorFallbackBody` へ渡す。型を1つにしてあるので、
 * 欄が増えたときに渡し忘れると tsc が落とす（JSX のスプレッドは余剰の欄を見ないが、
 * **足りない欄は見る**）。
 */
export type AppErrorFallbackProps = {
  /**
   * 「再表示」の隣に並べる出口。**再表示で戻らなかったとき**に使うものを渡す。
   * `AppErrorFallbackAction` を並べること。
   *
   * `children` にしないのは、同じファイルの `AppErrorBoundary` の `children`（囲う対象）と
   * 逆の意味になるため。`actions` にしないのは、`notification/Notice` の `actions` が
   * **描画済みの要素ではなく `NotifyAction[]`（データ）**を指していて、形が違うため。
   */
  extraActions?: ReactNode;
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
  /** 次に何をすればよいか。`AppErrorBoundary` の `hint` と同じもの */
  hint?: ReactNode;
  /** 浮かせて出す段の番号。`AppErrorBoundary` の `floatingSlot` と同じもの */
  floatingSlot?: number;
  /** 畳むのをやめて描き直す。原因が境界の外にあるなら効かない */
  reset: () => void;
  /** 浮かせた枠を閉じる。**浮かせていない境界では `undefined`** */
  dismiss?: () => void;
};

type State = {
  /** 浮かせた枠を利用者が閉じたか。閉じても `caught` は下ろさない（子は描き直さない） */
  dismissed: boolean;
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

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { caught: false, dismissed: false, error: null, keys: props.resetKeys ?? [] };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { caught: true, dismissed: false, error };
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
    return { caught: false, dismissed: false, error: null, keys };
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
    this.setState({ caught: false, dismissed: false, error: null });
  };

  /**
   * 浮かせた枠を閉じる。**`caught` は下ろさない** —— 下ろすと子を描き直して同じ行で落ちる。
   *
   * 浮かせた枠だけに要る。**`再表示` が効かない失敗では、箱は自分から消えない**ので、
   * 閉じる手段が無いとそのセッションのあいだ他の部品を覆い続ける。
   */
  dismiss = () => {
    this.setState({ dismissed: true });
  };

  render() {
    const { caught, dismissed, error } = this.state;
    if (caught) {
      // 閉じた浮かせ枠は何も描かない。子は畳んだままなので、原因を踏み直すこともない
      if (dismissed) return null;

      const view: AppErrorFallbackProps = {
        label: this.props.label,
        error,
        hint: this.props.hint,
        floatingSlot: this.props.floatingSlot,
        extraActions: this.props.extraActions,
        reset: this.reset,
        // 浮かせた枠だけが閉じられる。in-flow の器は閉じても隙間が残るだけで得が無い
        dismiss: this.props.floatingSlot === undefined ? undefined : this.dismiss,
      };
      if (this.props.fallback) {
        return this.props.fallback(view);
      }
      return <AppErrorFallbackBody {...view} />;
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
  hint,
  floatingSlot,
  reset,
  dismiss,
  extraActions,
  afterAction,
}: AppErrorFallbackProps & {
  /**
   * 出口を押した**結果**の知らせ。**出口の下に流れで置く**（重ねると出口を覆う）。
   *
   * `notice` にしないのは、同じ `shared/ui` の `notification/Notice` が
   * 「失敗を伝える箱」そのものの名前として先に使っているため。
   */
  afterAction?: ReactNode;
}) {
  // `throw` される値は `Error` とは限らない。**`String()` で落とさない** ——
  // plain object を投げると `[object Object]` がそのまま画面に出て、
  // 案内（`hint`）より目立つ位置に意味の無い1行が入る
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  return (
    <div
      className={`app-error-fallback${floatingSlot === undefined ? "" : " app-error-fallback--floating"}`}
      style={
        floatingSlot === undefined
          ? undefined
          : ({ "--error-fallback-slot": floatingSlot } as CSSProperties)
      }
    >
      <p>{label}を表示できませんでした。</p>
      {/*
        **これは報告用の材料で、利用者向けの説明ではない。** レンダ経路で実際に投げられるのは
        `plan walk overflows` のような開発者向けの英語なので、見出しを添えて役割を割る。
        次に何をすればよいかは `hint` が持つ
      */}
      {detail && <p className="app-error-fallback__detail">技術的な内容: {detail}</p>}
      {hint && <p className="app-error-fallback__hint">{hint}</p>}
      <div className="app-error-fallback__actions">
        <AppErrorFallbackAction onClick={reset}>{RETRY_LABEL}</AppErrorFallbackAction>
        {extraActions}
        {dismiss && (
          <AppErrorFallbackAction onClick={dismiss} secondary>
            閉じる
          </AppErrorFallbackAction>
        )}
      </div>
      {afterAction}
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
  /**
   * 押されたときにすること。**非同期でよい。**
   *
   * `() => void` に絞ると `() => Promise<void>` が代入できてしまい、拒否が誰にも
   * 拾われないまま消える（型でも lint でも赤くならない）。
   *
   * **ここで握るのは、未処理の拒否にしないためだけ。** `console.error` は配布版では読めないので
   * （同じファイルの `error` の doc）、**これは利用者に何も届けない。**
   * 押しても何も起きないボタンにしないために、**拒否を画面に出すのは呼び出し側の責任**で、
   * 置き場は `afterAction`（`app/RootErrorFallback.tsx` の `closeFailed` がその実装例）。
   */
  onClick: () => void | Promise<void>;
  secondary?: boolean;
  children: ReactNode;
}) {
  const run = () => {
    const result = onClick();
    if (result) {
      void result.catch((cause: unknown) => {
        console.error("[AppErrorFallbackAction] 出口が失敗:", cause);
      });
    }
  };

  return (
    <button
      type="button"
      className={`app-error-fallback__action${secondary ? " app-error-fallback__action--secondary" : ""}`}
      onClick={run}
    >
      {children}
    </button>
  );
}

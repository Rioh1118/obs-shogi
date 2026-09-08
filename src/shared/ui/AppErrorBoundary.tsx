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
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
};

type State = {
  error: Error | null;
  /** 直前に見た `resetKeys`。`getDerivedStateFromProps` は前の props を受け取れない */
  keys: readonly unknown[];
};

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, keys: props.resetKeys ?? [] };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
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
    return { error: null, keys };
  }

  // 落ちた原因はここでしか見られない。表示側は詳細を出さない
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `[AppErrorBoundary:${this.props.label}] Uncaught error:`,
      error,
      info.componentStack,
    );
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) {
        return this.props.fallback(error, this.reset);
      }
      return <AppErrorFallbackBody label={this.props.label} error={error} reset={this.reset} />;
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
}) {
  // `throw` される値は `Error` とは限らない。刈らないと `undefined` が画面に出る
  const detail = error instanceof Error ? error.message : String(error);

  return (
    <div className={`app-error-fallback${floating ? " app-error-fallback--floating" : ""}`}>
      <p>{label}を表示できませんでした。</p>
      {detail && <p className="app-error-fallback__detail">{detail}</p>}
      <button type="button" className="app-error-fallback__action" onClick={reset}>
        再表示
      </button>
    </div>
  );
}

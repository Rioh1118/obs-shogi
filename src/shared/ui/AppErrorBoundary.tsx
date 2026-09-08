import { Component, type ReactNode } from "react";
import "./AppErrorBoundary.scss";

type Props = {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
};

type State = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  // 落ちた原因はここでしか見られない。表示側は詳細を出さない
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[AppErrorBoundary] Uncaught error:", error, info.componentStack);
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
      return <AppErrorFallbackBody reset={this.reset} />;
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
export function AppErrorFallbackBody({ reset }: { reset: () => void }) {
  return (
    <div className="app-error-fallback">
      <p>表示中にエラーが発生しました。</p>
      <button type="button" className="app-error-fallback__action" onClick={reset}>
        再表示
      </button>
    </div>
  );
}

import { Component, type ReactNode } from "react";

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

  // 5: エラーをコンソールに記録
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
      // 4: インラインスタイルで最低限のフォールバック表示を保証
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1.2rem",
            padding: "2.4rem",
            color: "rgba(255,255,255,0.7)",
            fontSize: "1.3rem",
          }}
        >
          <p>表示中にエラーが発生しました。</p>
          <button
            type="button"
            onClick={this.reset}
            style={{
              padding: "0.6rem 1.4rem",
              borderRadius: "0.8rem",
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.8)",
              fontSize: "1.2rem",
              cursor: "pointer",
            }}
          >
            再表示
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

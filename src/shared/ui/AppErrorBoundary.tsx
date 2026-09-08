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
      return (
        <div className="app-error-fallback">
          <p>表示中にエラーが発生しました。</p>
          <button type="button" className="app-error-fallback__action" onClick={this.reset}>
            再表示
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

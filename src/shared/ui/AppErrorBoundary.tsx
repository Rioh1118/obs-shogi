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
        <div className="app-error-boundary">
          <p className="app-error-boundary__message">
            表示中にエラーが発生しました。
          </p>
          <button
            className="app-error-boundary__reset"
            onClick={this.reset}
            type="button"
          >
            再表示
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

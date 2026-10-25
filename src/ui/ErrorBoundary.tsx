import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches an error thrown while drawing a screen, so one broken page shows a message and a way out
 * instead of leaving the whole window blank. Give it a `key` that changes with the route to reset it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; scope?: "page" | "app" }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Screen failed to draw", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const app = this.props.scope === "app";
    return (
      <div className="page" role="alert">
        <div className="empty">
          <h2>Something went wrong on this screen</h2>
          <p className="muted">{error.message || "An unexpected error stopped this screen from drawing."} Your library is safe on this device.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn primary" onClick={() => location.reload()}>Reload</button>
            {!app && <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button>}
          </div>
        </div>
      </div>
    );
  }
}

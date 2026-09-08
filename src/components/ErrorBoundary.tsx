/**
 * ErrorBoundary — a thrown render error shows the error and a reload button.
 *
 * A white screen is the one failure a trading terminal must never show: it is
 * indistinguishable from "nothing is happening" while a position is open.
 * One boundary per tab and one around the detail page (App.tsx), so a bad
 * field in one card cannot take the feed and the account strip with it.
 */
import React from "react";

interface Props { name: string; children: React.ReactNode; onReset?: () => void }
interface State { error: Error | null; info: string | null }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> { return { error }; }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ info: info.componentStack ?? null });
    console.error(`[${this.props.name}] render failed:`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // A new child (another symbol, another tab) gets a fresh chance.
    if (prev.children !== this.props.children && this.state.error) this.setState({ error: null, info: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { name, onReset } = this.props;
    return (
      <div className="act stop" role="alert" id={`error-${name.toLowerCase()}`}>
        <div className="actgrid"><div className="left">
          <div className="ahead"><span className="sym">{name}</span></div>
          <div className="verb"><span className="v">RENDER FAILED</span></div>
          <p className="why">{this.state.error.message}</p>
          {this.state.info && <pre className="hint" style={{ whiteSpace: "pre-wrap", maxHeight: 120, overflow: "auto" }}>{this.state.info.trim().split("\n").slice(0, 6).join("\n")}</pre>}
          <p className="hint">Every other panel is still live. Reload this panel, or the page if it happens again.</p>
        </div>
        <div className="right">
          <button className="btn go" onClick={() => { this.setState({ error: null, info: null }); onReset?.(); }}>RELOAD PANEL</button>
          <button className="btn skip" onClick={() => window.location.reload()}>RELOAD PAGE</button>
        </div></div>
      </div>
    );
  }
}

import { Component, type ReactNode } from "react";
export class RendererBoundary extends Component<
  { children: ReactNode; recover: () => Promise<void> },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="score-paper">
        <p role="alert">
          The notation renderer could not load. Your notes, editor and MIDI
          export are still available.
        </p>
        <button onClick={() => void this.props.recover()}>
          Save session & reload renderer
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

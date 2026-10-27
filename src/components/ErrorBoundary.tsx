import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

interface Props {
  children: ReactNode;
  /** When this changes (a new route), a failed screen gets another try. */
  resetKey?: string;
}

interface State {
  failed: boolean;
}

/** Keep one screen's render error from unmounting the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen failed to render', error, info);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="pad">
        <header className="page-head">
          <h1>Something went wrong</h1>
        </header>
        <p className="muted">This screen hit a problem. Your sightings are safe on this phone.</p>
        <div className="row-end">
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <Link className="btn" to="/dex" onClick={() => this.setState({ failed: false })}>
            Back to Dex
          </Link>
        </div>
      </div>
    );
  }
}

/** The boundary around the routed screen: tapping a tab or going Back after a failure draws the new screen. */
export function ScreenBoundary({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  return <ErrorBoundary resetKey={pathname + search}>{children}</ErrorBoundary>;
}

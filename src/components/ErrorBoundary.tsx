import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  children: ReactNode;
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

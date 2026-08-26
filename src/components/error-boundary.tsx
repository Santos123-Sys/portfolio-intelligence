'use client';

/**
 * ErrorBoundary — catches render-time failures (a page throwing on an
 * unexpected response shape, for instance) and shows the same "Connection
 * failed" language used for handled fetch errors (Section 5.6), rather than
 * a blank white screen or Next.js's default error overlay.
 *
 * React error boundaries must be class components; there is no hook
 * equivalent as of React 19.
 */
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('Render error caught by ErrorBoundary:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <main>
          <div className="card">
            <h2>Connection error</h2>
            <p className="note">
              Connection failed: {this.state.error.message || 'Unable to reach backend.'}
              <br />
              Check that the API is running and DATABASE_URL is set.
            </p>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

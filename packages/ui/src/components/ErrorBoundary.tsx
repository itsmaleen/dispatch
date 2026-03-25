import { Component, type ReactNode, type ErrorInfo } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleRecover = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#09090b',
            color: '#e4e4e7',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: '28rem',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1rem',
            }}
          >
            <div
              style={{
                width: '3rem',
                height: '3rem',
                borderRadius: '50%',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.25rem',
              }}
            >
              !
            </div>
            <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>
              Something went wrong
            </h2>
            <p style={{ margin: 0, fontSize: '0.875rem', color: '#a1a1aa' }}>
              An unexpected error occurred. You can try recovering or reload the app.
            </p>
            {this.state.error && (
              <pre
                style={{
                  margin: 0,
                  padding: '0.75rem 1rem',
                  backgroundColor: '#18181b',
                  borderRadius: '0.5rem',
                  border: '1px solid #27272a',
                  fontSize: '0.75rem',
                  color: '#ef4444',
                  textAlign: 'left',
                  maxWidth: '100%',
                  overflow: 'auto',
                  maxHeight: '6rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                onClick={this.handleRecover}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '0.375rem',
                  border: '1px solid #3f3f46',
                  backgroundColor: '#27272a',
                  color: '#e4e4e7',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                }}
              >
                Try to recover
              </button>
              <button
                onClick={this.handleReload}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '0.375rem',
                  border: 'none',
                  backgroundColor: '#7c3aed',
                  color: '#ffffff',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                }}
              >
                Reload app
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

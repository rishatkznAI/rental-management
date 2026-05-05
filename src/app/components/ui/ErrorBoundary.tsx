import { Component, type ReactNode } from 'react';
import { AppErrorState } from './AppErrorState';
import { tokenMarker, traceAuth } from '../../lib/authDebug';
import { AUTH_TOKEN_KEY } from '../../lib/api';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    let storedToken: string | null = null;
    try {
      storedToken = window.localStorage.getItem(AUTH_TOKEN_KEY);
    } catch {
      storedToken = null;
    }
    traceAuth('ErrorBoundary caught error', {
      message: error.message,
      route: window.location.hash || window.location.pathname,
      token: tokenMarker(storedToken),
      componentStack: info.componentStack,
    }, { stack: true });
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleBack = () => {
    window.history.back();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <AppErrorState
        title="Что-то пошло не так"
        description="Произошла ошибка при отображении страницы. Попробуйте обновить страницу или вернуться назад."
        onBack={this.handleBack}
        onReload={this.handleReload}
      />
    );
  }
}

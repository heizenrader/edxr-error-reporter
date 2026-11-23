import { Component, type ErrorInfo, type ReactNode } from "react";
import { report } from "./index";

export interface ErrorBoundaryProps {
  children?: ReactNode;
  /** What to show after a render crash. A function gets the error. */
  fallback?: ReactNode | ((error: Error) => ReactNode);
}

interface BoundaryState {
  error: Error | null;
}

/** Catches a render crash, reports it (with the component stack) and shows the fallback. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void report(error, { componentStack: info.componentStack || "" });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { fallback } = this.props;
    return typeof fallback === "function" ? fallback(error) : (fallback ?? null);
  }
}

"use client";

/**
 * Minimal error boundary.
 *
 * The hero has two places where a failure must degrade instead of blank the
 * page: the canvas (→ the still-composed poster) and the optional GLB
 * (→ the procedural 911). React has no hook for catching render errors, so this
 * is a typed class component; the caught error is intentionally not logged.
 */

import { Component, type ReactNode } from "react";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** rendered instead of the children once something below has thrown */
  fallback: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(): void {
    // swallowed: both call sites have a designed fallback, and a WebGL failure
    // is an environment fact, not an application bug worth logging.
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

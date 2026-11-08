"use client";

import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function ViewLoading() {
  return <div role="status" aria-label="Loading view" className="space-y-4 py-6">
    <span className="sr-only">Loading view…</span>
    <div className="h-8 w-56 animate-pulse rounded-lg bg-muted" />
    <div className="h-48 animate-pulse rounded-xl bg-muted" />
  </div>;
}

export class ViewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert" className="rounded-xl border p-6">
      <p>This view couldn’t be opened. Try again or choose another tab.</p>
      <Button className="mt-3" variant="outline" onClick={() => this.setState({ failed: false })}>Try again</Button>
    </div>;
    return this.props.children;
  }
}

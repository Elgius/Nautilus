import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

export function AuthShell({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="auth-shell">
      <div className={`auth-panel${wide ? " auth-panel-wide" : ""}`}>
        <Link href="/" className="auth-brand" aria-label="Nautilus home">
          <BrandMark className="size-16" />
        </Link>
        {children}
        <p className="auth-footer">Room to think. Power to do.</p>
      </div>
    </main>
  );
}

export function AuthLoading({
  message = "Loading your workspace…",
}: {
  message?: string;
}) {
  return (
    <AuthShell>
      <p className="auth-loading" role="status">
        {message}
      </p>
    </AuthShell>
  );
}

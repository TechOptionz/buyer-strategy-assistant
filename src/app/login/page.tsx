import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Buyer Strategy Assistant" };

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const raw = typeof sp.next === "string" ? sp.next : "/cases";
  // Only allow same-site relative paths (no open redirects).
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/cases";
  if (await getAuth().catch(() => null)) redirect(next);
  return (
    <main id="main" className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-[380px] flex-col gap-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 flex-none items-center justify-center rounded bg-ink text-[11px] font-semibold tracking-[0.04em] text-white">BSA</div>
          <span className="text-sm font-semibold">Buyer Strategy Assistant</span>
        </div>
        <div className="rounded-lg border border-line bg-surface px-6 py-6">
          <h1 className="text-[22px] font-semibold">Sign in</h1>
          <p className="mt-1 text-[13px] text-ink-secondary">Sign in to your organisation workspace.</p>
          <LoginForm next={next} />
        </div>
        {process.env.NODE_ENV !== "production" && (
          <p className="text-xs text-muted">
            Development: demo accounts are listed in <code className="font-mono">src/lib/db/seed.ts</code>.
          </p>
        )}
      </div>
    </main>
  );
}

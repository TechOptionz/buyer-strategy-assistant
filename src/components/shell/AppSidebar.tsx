"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cx } from "@/components/ui";
import { initials, ROLE_LABEL } from "@/lib/format";
import { pinStore } from "./pins";

export interface NavSummary {
  cases: number;
  review: number;
  all: { id: string; name: string; status: string }[];
}

const PIN_MARK: Record<string, { text: string; cls: string; title: string }> = {
  needs_clarification: { text: "⚠︎ Clarify", cls: "text-warn", title: "Needs clarification" },
  ready_for_review: { text: "→ Review", cls: "text-accent", title: "Ready for review" },
  reviewed: { text: "✓ Reviewed", cls: "text-ok", title: "Reviewed" },
  draft: { text: "• In progress", cls: "text-muted", title: "Interview in progress" },
};

export function AppSidebar({ user, nav, isAdmin }: { user: { name: string; role: string; organisationName: string }; nav: NavSummary; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams();

  // Close the mobile drawer on navigation (render-time reset, no effect needed).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface px-2 md:hidden">
        <button type="button" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(true)} className="flex h-11 w-11 items-center justify-center text-lg">
          ☰
        </button>
        <span className="flex-1 text-base font-semibold">Buyer Strategy Assistant</span>
      </div>
      {open && <div className="fixed inset-0 z-40 bg-[rgba(21,24,28,0.32)] md:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-[232px] shrink-0 flex-col gap-5 border-r border-line bg-subtle px-3 py-4 transition-transform md:sticky md:top-0 md:z-auto md:h-screen md:translate-x-0",
          open ? "translate-x-0 shadow-[var(--shadow-overlay)]" : "-translate-x-full",
        )}
        aria-label="Main navigation"
      >
        <div className="flex items-center gap-2.5 px-1.5">
          <div className="flex h-7 w-7 flex-none items-center justify-center rounded bg-ink text-[10px] font-semibold tracking-[0.04em] text-white">BSA</div>
          <div className="flex min-w-0 flex-col">
            <span className="text-[13px] leading-tight font-semibold">Buyer Strategy Assistant</span>
            <span className="truncate text-xs leading-snug text-muted">{user.organisationName}</span>
          </div>
        </div>

        <JumpToCase cases={nav.all} />

        <nav className="flex flex-col gap-0.5">
          <NavItem href="/cases" label="Cases" count={nav.cases} active={pathname.startsWith("/cases") && search.get("view") !== "review"} />
          <NavItem href="/cases?view=review" label="Ready for my review" count={nav.review} active={pathname === "/cases" && search.get("view") === "review"} />
          {isAdmin && <NavItem href="/admin" label="Administration" active={pathname.startsWith("/admin")} />}
        </nav>

        <PinnedCases cases={nav.all} />

        <div className="flex-1" />
        <div className="flex items-center gap-2.5 border-t border-line px-1.5 pt-2.5">
          <div className="flex h-7 w-7 flex-none items-center justify-center rounded border border-line bg-neutral-tint text-[11px] font-semibold text-neutral">{initials(user.name)}</div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-medium">{user.name}</span>
            <span className="truncate text-xs text-muted">{ROLE_LABEL[user.role] ?? user.role}</span>
          </div>
          <SignOutButton />
        </div>
      </aside>
    </>
  );
}

function NavItem({ href, label, count, active }: { href: string; label: string; count?: number; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex h-8 items-center gap-2 rounded px-2.5 text-[13px] no-underline hover:no-underline",
        active ? "bg-accent-tint font-medium text-accent hover:text-accent" : "text-ink-2 hover:bg-hover hover:text-ink-2",
      )}
    >
      <span className="flex-1">{label}</span>
      {count != null && count > 0 && <span className={cx("text-xs", !active && "text-muted")}>{count}</span>}
    </Link>
  );
}

function JumpToCase({ cases }: { cases: NavSummary["all"] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const matches = q.trim() ? cases.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : [];
  return (
    <div className="relative">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (matches[0]) router.push(`/cases/${matches[0].id}`);
          else router.push(`/cases?q=${encodeURIComponent(q.trim())}`);
          setQ("");
          input.current?.blur();
        }}
        className="flex h-8 items-center gap-2 rounded border border-line bg-surface pr-2 pl-2.5 focus-within:border-accent"
      >
        <label htmlFor="jump" className="sr-only">
          Jump to case
        </label>
        <input
          ref={input}
          id="jump"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          placeholder="Jump to case…"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
        />
        <kbd className="rounded border border-line px-1.5 py-px font-sans text-[11px] text-ink-secondary">⌘K</kbd>
      </form>
      {focus && matches.length > 0 && (
        <ul className="absolute inset-x-0 top-9 z-10 overflow-hidden rounded border border-line bg-surface py-1 shadow-[var(--shadow-overlay)]">
          {matches.map((m) => (
            <li key={m.id}>
              <Link href={`/cases/${m.id}`} className="block truncate px-2.5 py-1.5 text-[13px] text-ink no-underline hover:bg-hover hover:no-underline">
                {m.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PinnedCases({ cases }: { cases: NavSummary["all"] }) {
  const pins = useSyncExternalStore(pinStore.subscribe, pinStore.get, pinStore.server);
  const pinned = pins.map((id) => cases.find((c) => c.id === id)).filter(Boolean) as NavSummary["all"];
  if (!pinned.length) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-2.5 pb-1.5 text-xs font-medium text-muted">Pinned cases</div>
      {pinned.map((c) => {
        const m = PIN_MARK[c.status] ?? PIN_MARK.draft;
        return (
          <Link key={c.id} href={`/cases/${c.id}`} className="flex h-8 items-center gap-2 rounded px-2.5 text-[13px] text-ink no-underline hover:bg-hover hover:text-ink hover:no-underline">
            <span className="flex-1 truncate">{c.name}</span>
            <span className={cx("text-[11px]", m.cls)} title={m.title}>
              {m.text}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function SignOutButton() {
  return (
    <button
      type="button"
      title="Sign out"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
      }}
      className="rounded px-1.5 py-1 text-xs text-ink-secondary hover:bg-hover hover:text-ink"
    >
      Sign out
    </button>
  );
}

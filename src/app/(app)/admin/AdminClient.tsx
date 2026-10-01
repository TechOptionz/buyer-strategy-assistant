"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { cx, Select } from "@/components/ui";
import { time } from "@/lib/format";
import { SavedContext, type AdminProps } from "./shared";
import { UsersSection } from "./UsersSection";
import { BrandingSection, InterviewSection, ProvidersSection, RetentionSection } from "./SettingsSections";
import { HealthSection } from "./HealthSection";

export type { AdminMember, AdminProps } from "./shared";

const SECTIONS = [
  { id: "users", label: "Users and permissions" },
  { id: "branding", label: "Branding" },
  { id: "providers", label: "Data providers" },
  { id: "interview", label: "Interview configuration" },
  { id: "retention", label: "Retention" },
  { id: "health", label: "Health" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

/** Legacy anchors (#freshness) and aliases map onto the section that now holds them. */
const ALIAS: Record<string, SectionId> = { freshness: "providers" };
function toSection(v: string | null | undefined): SectionId | null {
  if (!v) return null;
  if (ALIAS[v]) return ALIAS[v];
  return SECTIONS.some((s) => s.id === v) ? (v as SectionId) : null;
}

export function AdminClient(props: AdminProps) {
  const search = useSearchParams();
  const section: SectionId = toSection(search.get("section")) ?? "users";
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const markSaved = useCallback((at: Date) => setSavedAt(at), []);

  const go = useCallback((id: SectionId) => {
    const params = new URLSearchParams(window.location.search);
    params.set("section", id);
    window.history.pushState(null, "", `?${params.toString()}`);
  }, []);

  // Old links used #users / #branding anchors: translate them to ?section= once on load.
  useEffect(() => {
    const fromHash = toSection(window.location.hash.slice(1));
    if (fromHash && !new URLSearchParams(window.location.search).get("section")) {
      window.history.replaceState(null, "", `?section=${fromHash}`);
    }
  }, []);

  const current = SECTIONS.find((s) => s.id === section)!;
  const saved = savedAt ? (
    <span className="text-xs whitespace-nowrap text-muted" role="status">
      <span className="text-ok" aria-hidden="true">
        ✓
      </span>{" "}
      Saved · {time(savedAt)}
    </span>
  ) : null;

  let body: ReactNode;
  switch (section) {
    case "users":
      body = <UsersSection members={props.members} currentUserId={props.currentUserId} saved={saved} title={current.label} />;
      break;
    case "branding":
      body = <BrandingSection settings={props.settings} saved={saved} title={current.label} />;
      break;
    case "providers":
      body = <ProvidersSection ai={props.ai} marketProvider={props.marketProvider} metrics={props.metrics} freshnessDays={props.settings.freshnessDays} saved={saved} title={current.label} />;
      break;
    case "interview":
      body = <InterviewSection interview={props.interview} title={current.label} />;
      break;
    case "retention":
      body = <RetentionSection retentionDays={props.settings.retentionDays} saved={saved} title={current.label} />;
      break;
    case "health":
      body = <HealthSection canViewMetrics={props.canViewHealthMetrics} title={current.label} />;
      break;
  }

  return (
    <SavedContext.Provider value={markSaved}>
      <div className="flex min-h-full flex-1 flex-col md:flex-row">
        <nav aria-label="Administration sections" className="hidden w-[200px] flex-none flex-col gap-0.5 border-r border-line bg-surface px-3 py-6 md:flex">
          <span className="px-2.5 pb-2 text-xs font-medium text-muted">Administration</span>
          {SECTIONS.map((s) => {
            const on = s.id === section;
            return (
              <a
                key={s.id}
                href={`?section=${s.id}`}
                aria-current={on ? "page" : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  go(s.id);
                }}
                className={cx(
                  "flex h-8 items-center rounded px-2.5 text-[13px] no-underline hover:no-underline",
                  on ? "bg-accent-tint font-medium text-accent hover:text-accent" : "text-ink-2 hover:bg-hover hover:text-ink",
                )}
              >
                {s.label}
              </a>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-6 px-4 py-4 md:px-8 md:py-6">
          <div className="flex flex-col gap-1.5 md:hidden">
            <label htmlFor="admin-section" className="text-xs font-medium text-muted">
              Administration
            </label>
            <Select id="admin-section" value={section} onChange={(e) => go(e.target.value as SectionId)} className="h-11 text-[15px]">
              {SECTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          {body}
        </div>
      </div>
    </SavedContext.Provider>
  );
}

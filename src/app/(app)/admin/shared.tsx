"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, ClientApiError } from "@/lib/client/api";
import { cx } from "@/components/ui";

export type Role = "org_admin" | "buyer_agent" | "reviewer";
export type Permission = "case_access_all" | "edit_profile" | "review" | "manage_org";

export interface AdminMember {
  userId: string;
  email: string;
  name: string;
  role: Role;
  permissions: Permission[];
  /** Cases where the user is the assigned agent or the assigned reviewer (the basis of case access). */
  assignedCases: number;
}

export interface AdminProps {
  currentUserId: string;
  canViewHealthMetrics: boolean;
  organisationName: string;
  members: AdminMember[];
  settings: {
    brandName: string;
    reportFooter: string;
    attribution: string;
    retentionDays: number | null;
    freshnessDays: Record<string, number>;
  };
  metrics: { key: string; label: string; help: string; defaultFreshDays: number | null }[];
  ai: { configured: boolean; provider: string; model: string | null };
  marketProvider: { id: string; label: string; configured: boolean };
  interview: {
    version: string;
    questions: {
      key: string;
      topic: string;
      prompt: string;
      answerType: string;
      requiredFor: string[];
      optional: boolean;
      priority: number;
      perProperty: boolean;
    }[];
  };
}

export type FormError = { message: string; fieldErrors: Record<string, string> };

export function errorOf(e: unknown): FormError {
  if (e instanceof ClientApiError) return { message: e.body?.message ?? e.message, fieldErrors: e.body?.fieldErrors ?? {} };
  return { message: e instanceof Error ? e.message : "Something went wrong", fieldErrors: {} };
}

/* "✓ Saved · HH:MM" in the title row after any successful save. */
export const SavedContext = createContext<(at: Date) => void>(() => {});

export function useSettingsSave() {
  const router = useRouter();
  const markSaved = useContext(SavedContext);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<FormError | null>(null);
  const save = async (body: Record<string, unknown>, success: string) => {
    setSaving(true);
    setOk(null);
    setErr(null);
    try {
      await api("/api/admin/settings", { method: "PATCH", body });
      setOk(success);
      markSaved(new Date());
      router.refresh();
      return true;
    } catch (e) {
      setErr(errorOf(e));
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { saving, ok, err, save, setErr };
}

/** 8px white panel · 14/20 header with 16/600 title · optional footer bar. */
export function Panel({
  title,
  aside,
  children,
  footer,
  className,
  id,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cx("overflow-hidden rounded-lg border border-line bg-surface", className)} aria-label={typeof title === "string" ? title : undefined}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-3.5 md:px-5">
        <h2 className="flex-1 text-base font-semibold text-ink">{title}</h2>
        {aside}
      </header>
      {children}
      {footer && <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 md:px-5">{footer}</div>}
    </section>
  );
}

/** Table header row: 32px, subtle background, 12/500 muted. */
export const TH = "h-8 border-b border-line bg-subtle px-3 text-left text-xs font-medium whitespace-nowrap text-muted first:pl-5 last:pr-5";
/** Table body cell: hairline row divider. */
export const TD = "border-b border-line-soft px-3 py-2.5 align-top first:pl-5 last:pr-5";

export const TONE_TEXT = { ok: "text-ok", warn: "text-warn", bad: "text-bad", est: "text-est", muted: "text-muted", ink: "text-ink-2" } as const;
export type TextTone = keyof typeof TONE_TEXT;

/** Title row: h1 22/600 · saved indicator · optional primary action. */
export function TitleRow({ title, saved, action }: { title: string; saved?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h1 className="flex-1 text-[22px] leading-tight font-semibold text-ink">{title}</h1>
      {saved}
      {action}
    </div>
  );
}

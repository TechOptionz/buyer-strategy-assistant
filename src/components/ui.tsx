"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

/* ─────────────────────────────── Buttons ─────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost" | "danger";
type ButtonSize = "xs" | "sm" | "md" | "lg";

/**
 * One solid primary per view · outlined secondary · text tertiary. Destructive red only inside a
 * confirmation dialog. Disabled buttons show the reason beside them.
 */
export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed",
        size === "xs" && "h-7 px-2.5 text-xs",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-9 px-3.5 text-sm",
        size === "lg" && "h-11 px-4 text-[15px]",
        variant === "primary" && "border border-accent bg-accent text-accent-ink hover:border-accent-hover hover:bg-accent-hover disabled:border-line disabled:bg-disabled disabled:text-faint",
        variant === "secondary" && "border border-line-strong bg-surface text-ink hover:bg-hover disabled:border-line disabled:bg-disabled disabled:text-faint",
        variant === "tertiary" && "border border-transparent bg-transparent !px-2.5 text-accent hover:text-accent-hover hover:underline disabled:text-faint disabled:no-underline",
        variant === "ghost" && "border border-transparent bg-transparent !px-2.5 text-ink-secondary hover:bg-hover hover:text-ink disabled:text-faint",
        variant === "danger" && "border border-bad bg-bad text-white hover:brightness-95 disabled:border-line disabled:bg-disabled disabled:text-faint",
        className,
      )}
    />
  );
}

/** Segmented control (Scenarios | Suburbs, Interest-only | P&I). */
export function Segmented<T extends string>({ value, options, onChange, label, dark, size = "sm" }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string; dark?: boolean; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("inline-flex overflow-hidden rounded border border-line-strong bg-surface", size === "sm" ? "h-[32px]" : "h-9")}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "flex items-center justify-center px-3 text-[13px] whitespace-nowrap",
              i > 0 && "border-l border-line-strong",
              on ? (dark ? "bg-ink font-medium text-white" : "bg-accent-tint font-medium text-accent") : "text-ink-2 hover:bg-hover",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────── Panels ─────────────────────────────── */

/** 8px panel, hairline border, no shadow at rest. */
export function Card({ title, actions, children, className, bodyClassName, id, flush, sub }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string; flush?: boolean; sub?: ReactNode }) {
  return (
    <section id={id} className={cx("rounded-lg border border-line bg-surface", className)} aria-label={typeof title === "string" ? title : undefined}>
      {(title || actions) && (
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-5 py-3.5">
          {title && <h2 className="flex-1 text-base font-semibold text-ink">{title}</h2>}
          {sub && <span className="text-xs text-muted">{sub}</span>}
          {actions && <div className="flex flex-wrap items-center gap-2 text-[13px]">{actions}</div>}
        </header>
      )}
      <div className={cx(!flush && "px-5 py-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ─────────────────────────────── Status ─────────────────────────────── */

export type Tone = "ok" | "warn" | "bad" | "info" | "est" | "neutral" | "muted";

const BADGE: Record<Tone, string> = {
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-warn",
  bad: "bg-bad-tint text-bad",
  info: "bg-accent-tint text-accent",
  est: "bg-est-tint text-est",
  neutral: "bg-neutral-tint text-neutral",
  muted: "bg-neutral-tint text-muted",
};
const ICON: Record<Tone, string> = { ok: "✓", warn: "⚠︎", bad: "✕", info: "→", est: "◐", neutral: "○", muted: "•" };

/** StatusBadge: tinted 22px badge. Always icon + word, never colour alone. */
export function Badge({ tone = "neutral", icon, children, title, strike }: { tone?: Tone; icon?: string | null; children: ReactNode; title?: string; strike?: boolean }) {
  const ic = icon === undefined ? ICON[tone] : icon;
  return (
    <span title={title} className={cx("inline-flex h-[22px] items-center gap-1 rounded px-1.5 text-xs font-medium whitespace-nowrap", BADGE[tone], strike && "line-through")}>
      {ic && <span aria-hidden="true">{ic}</span>}
      {children}
    </span>
  );
}

/** Legacy alias. */
export function Chip({ tone = "muted", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <Badge tone={tone} title={title}>
      {children}
    </Badge>
  );
}

/** Case lifecycle (design: StatusBadge · Case). */
export const CASE_STATUS: Record<string, { tone: Tone; icon: string; label: string }> = {
  draft: { tone: "neutral", icon: "•", label: "Interview in progress" },
  /** Still a draft case, but past the interview: scenarios or a report exist. */
  assessing: { tone: "neutral", icon: "•", label: "Assessment in progress" },
  needs_clarification: { tone: "warn", icon: "⚠︎", label: "Needs clarification" },
  ready_for_review: { tone: "info", icon: "→", label: "Ready for review" },
  needs_changes: { tone: "warn", icon: "↺", label: "Changes requested" },
  reviewed: { tone: "ok", icon: "✓", label: "Reviewed" },
};

/** Report lifecycle: Draft → Ready for review → Changes requested → Reviewed → Superseded. */
export const REPORT_STATUS: Record<string, { tone: Tone; icon: string; label: string }> = {
  draft: { tone: "neutral", icon: "○", label: "Draft" },
  ready_for_review: { tone: "info", icon: "→", label: "Ready for review" },
  needs_changes: { tone: "warn", icon: "↺", label: "Changes requested" },
  reviewed: { tone: "ok", icon: "✓", label: "Reviewed" },
  superseded: { tone: "muted", icon: "", label: "Superseded" },
};

export function CaseStatusBadge({ status }: { status: string }) {
  const s = CASE_STATUS[status] ?? CASE_STATUS.draft;
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}

export function ReportStatusBadge({ status }: { status: string }) {
  const s = REPORT_STATUS[status] ?? REPORT_STATUS.draft;
  return (
    <Badge tone={s.tone} icon={s.icon || null} strike={status === "superseded"}>
      {s.label}
    </Badge>
  );
}

export const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  needs_clarification: "warn",
  ready_for_review: "info",
  reviewed: "ok",
  needs_changes: "warn",
  superseded: "muted",
  ready: "ok",
  partial: "warn",
  not_ready: "bad",
  complete: "ok",
  incomplete: "warn",
  invalid: "bad",
  pass: "ok",
  fail: "bad",
  unresolved: "warn",
  warning: "warn",
  meets: "ok",
  partly_meets: "warn",
  does_not_meet: "bad",
  unknown: "muted",
};

export const human = (s: string) => s.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

export function StatusChip({ status, label }: { status: string; label?: string }) {
  if (!label && REPORT_STATUS[status]) return <ReportStatusBadge status={status} />;
  const tone = STATUS_TONE[status] ?? "muted";
  const icon = status === "unknown" ? "?" : status === "partly_meets" || status === "partial" ? "◐" : undefined;
  return (
    <Badge tone={tone} icon={icon}>
      {label ?? human(status)}
    </Badge>
  );
}

export type MarkKind = "confirmed" | "calculated" | "suggested" | "estimated" | "review" | "notconfirmed" | "conflict" | "assumption" | "missing" | "notasked" | "current" | "stale" | "blocking" | "unknown";

export const MARKS: Record<MarkKind, { icon: string; label: string; cls: string }> = {
  confirmed: { icon: "✓", label: "Confirmed", cls: "text-ok" },
  calculated: { icon: "✓", label: "Calculated", cls: "text-ok" },
  suggested: { icon: "◐", label: "Suggested", cls: "text-est" },
  estimated: { icon: "◐", label: "Estimated", cls: "text-est" },
  review: { icon: "⚠︎", label: "Needs review", cls: "text-warn" },
  notconfirmed: { icon: "⚠︎", label: "Not confirmed", cls: "text-warn" },
  conflict: { icon: "⚠︎", label: "Needs review", cls: "text-warn" },
  assumption: { icon: "○", label: "Assumption", cls: "text-neutral" },
  missing: { icon: "—", label: "Not provided", cls: "text-muted" },
  notasked: { icon: "—", label: "Not yet asked", cls: "text-muted" },
  current: { icon: "●", label: "Asking now", cls: "text-accent" },
  stale: { icon: "↻", label: "Out of date", cls: "text-warn" },
  blocking: { icon: "✕", label: "Blocking", cls: "text-bad" },
  unknown: { icon: "?", label: "Unknown", cls: "text-muted" },
};

/** StatusMark: inline text, no fill. Sits right of the value it qualifies. Icon is aria-hidden. */
export function Mark({ kind, label, className, small }: { kind: MarkKind; label?: string; className?: string; small?: boolean }) {
  const m = MARKS[kind];
  return (
    <span className={cx("inline-flex items-center gap-1 font-medium whitespace-nowrap", small ? "text-[11px]" : "text-xs", m.cls, className)}>
      <span aria-hidden="true">{m.icon}</span>
      {label ?? m.label}
    </span>
  );
}

/** SourceLabel: plain grey 12px text, never a badge. */
export function Source({ children, className, small }: { children: ReactNode; className?: string; small?: boolean }) {
  return <span className={cx("text-muted", small ? "text-[11px]" : "text-xs", className)}>{children}</span>;
}

/** TracedValue: label · value · mark · source. */
export function Traced({ label, value, mark, source, onClick, selected, muted, className, large }: { label: ReactNode; value: ReactNode; mark?: ReactNode; source?: ReactNode; onClick?: () => void; selected?: boolean; muted?: boolean; className?: string; large?: boolean }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cx("grid w-full grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-left", onClick && "cursor-pointer hover:bg-subtle", selected && "bg-accent-wash shadow-[inset_2px_0_0_var(--color-accent)]", className)}
    >
      <span className={cx("text-ink-secondary", large ? "text-sm" : "text-[13px]")}>{label}</span>
      <span className={cx("text-right font-medium", large ? "text-base" : "text-sm", muted ? "text-muted" : "text-ink")}>{value}</span>
      <span className="text-xs text-muted">{source}</span>
      <span className="text-right">{mark}</span>
    </Tag>
  );
}

/* ─────────────────────────────── Forms ─────────────────────────────── */

export function Field({ label, htmlFor, error, hint, children, className, extra }: { label: ReactNode; htmlFor: string; error?: string; hint?: ReactNode; children: ReactNode; className?: string; extra?: ReactNode }) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline gap-2">
        <label htmlFor={htmlFor} className="flex-1 text-[13px] font-medium text-ink-secondary">
          {label}
        </label>
        {extra}
      </div>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-bad">
          <span aria-hidden="true">⚠︎ </span>
          {error}
        </p>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded border border-line-strong bg-surface px-2.5 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-2 focus:outline-offset-1 focus:outline-accent disabled:bg-disabled disabled:text-faint";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const { invalid, className, ...rest } = props;
  return <input {...rest} aria-invalid={invalid || undefined} className={cx(inputCls, "h-9", invalid && "border-bad", className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  const { className, invalid, ...rest } = props;
  return <textarea {...rest} aria-invalid={invalid || undefined} className={cx(inputCls, "min-h-24 py-2.5 leading-relaxed", invalid && "border-bad", className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, ...rest } = props;
  return <select {...rest} className={cx(inputCls, "h-9 pr-8", className)} />;
}

/** Input with unit affixes: [$][ 800,000 ] or [ 6.50 ][% p.a.]. Label above, value right-aligned. */
export function AffixInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> & { invalid?: boolean; prefix?: ReactNode; suffix?: ReactNode; align?: "left" | "right"; inputClassName?: string }) {
  const { invalid, className, prefix, suffix, align = "right", inputClassName, ...rest } = props;
  return (
    <span
      className={cx(
        "flex h-9 items-stretch overflow-hidden rounded border bg-surface focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent",
        invalid ? "border-bad" : "border-line-strong",
        className,
      )}
    >
      {prefix && <span className="flex items-center border-r border-line bg-subtle px-2 text-sm text-muted">{prefix}</span>}
      <input {...rest} aria-invalid={invalid || undefined} className={cx("num min-w-0 flex-1 bg-transparent px-2.5 text-sm text-ink outline-none placeholder:text-faint", align === "right" && "text-right", inputClassName)} />
      {suffix && <span className="flex items-center border-l border-line bg-subtle px-2 text-[13px] text-muted whitespace-nowrap">{suffix}</span>}
    </span>
  );
}

/** Monetary input: accepts "$750,000", "750k", "1.2m". */
export function MoneyInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "prefix"> & { invalid?: boolean; suffix?: ReactNode }) {
  return <AffixInput {...props} type="text" inputMode="decimal" autoComplete="off" prefix="$" />;
}

/* ─────────────────────────────── Feedback ─────────────────────────────── */

const ALERT: Record<Tone, { box: string; title: string; body: string; icon: string }> = {
  ok: { box: "border-ok-line bg-ok-tint", title: "text-ok", body: "text-ink-2", icon: "✓" },
  warn: { box: "border-warn-line bg-warn-tint", title: "text-warn", body: "text-warn-ink", icon: "⚠︎" },
  bad: { box: "border-bad-line bg-bad-tint", title: "text-bad", body: "text-bad-ink", icon: "✕" },
  info: { box: "border-accent-line bg-accent-wash", title: "text-accent", body: "text-ink-2", icon: "→" },
  est: { box: "border-est-line bg-est-wash", title: "text-est", body: "text-ink-2", icon: "◐" },
  neutral: { box: "border-line bg-surface", title: "text-ink", body: "text-ink-secondary", icon: "○" },
  muted: { box: "border-line bg-subtle", title: "text-ink", body: "text-ink-secondary", icon: "•" },
};

/** Status panel: tint + border + icon + words. */
export function Alert({ tone = "info", title, children, action, icon, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode; icon?: string; className?: string }) {
  const a = ALERT[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cx("flex flex-wrap items-start gap-3 rounded border px-4 py-3 text-[13px]", a.box, className)}>
      <span aria-hidden="true" className={cx("leading-5", a.title)}>
        {icon ?? a.icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title && <p className={cx("font-semibold", a.title)}>{title}</p>}
        {children && <div className={a.body}>{children}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** Empty: states the reason and the next action. No illustration. */
export function EmptyState({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-3 py-6", className)}>
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      {children && <div className="max-w-[460px] text-sm leading-relaxed text-ink-secondary">{children}</div>}
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-[13px] text-muted">
      <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-transparent" />
      {label}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("h-2.5 rounded-sm bg-line-soft", className)} />;
}

export function KeyValue({ items }: { items: { k: ReactNode; v: ReactNode; id?: string; changed?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] text-[13px]">
      {items.map((it, i) => (
        <div key={it.id ?? i} className="contents">
          <dt className="border-b border-line-soft py-2 text-ink-secondary">{it.k}</dt>
          <dd className={cx("num border-b border-line-soft py-2 text-right font-medium text-ink", it.changed && "just-changed rounded px-1")}>{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Section label used inside panels: 12/500 muted. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("text-xs font-medium text-muted", className)}>{children}</div>;
}

/* ─────────────────────────────── Overlays ─────────────────────────────── */

/**
 * SidePanel: 420px right panel, overlay shadow, Esc closes. The underlying view stays visible.
 * Mobile: full-screen sheet with a back arrow.
 */
export function SidePanel({ open, onClose, label, children, footer, width = 420 }: { open: boolean; onClose: () => void; label: string; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <aside
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label={label}
      style={{ ["--panel-w" as string]: `${width}px` }}
      className="fixed inset-0 z-40 flex flex-col bg-surface outline-none md:inset-y-0 md:right-0 md:left-auto md:w-[var(--panel-w)] md:border-l md:border-line md:shadow-[var(--shadow-panel)]"
    >
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line px-2 md:hidden">
        <button type="button" onClick={onClose} aria-label="Back" className="flex h-11 w-11 items-center justify-center text-lg">
          ←
        </button>
        <span className="text-[15px] font-semibold">{label}</span>
      </div>
      <div className="hidden items-center gap-2 px-6 pt-5 md:flex">
        <span className="flex-1 text-xs text-muted">{label} · Esc to close</span>
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded text-base text-ink-secondary hover:bg-hover">
          ×
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      {footer && <div className="flex shrink-0 gap-2 border-t border-line px-4 py-3 pb-7 md:px-6 md:py-4">{footer}</div>}
    </aside>
  );
}

/** Modal dialog using the native <dialog> element. */
export function Modal({ open, onClose, title, children, footer, width = 420 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      style={{ width: `min(92vw, ${width}px)` }}
      className="m-auto rounded-lg border border-line bg-surface p-0 text-ink shadow-[var(--shadow-overlay)]"
    >
      {open && (
        <div className="flex flex-col gap-3 p-5">
          <h2 className="text-base font-semibold">{title}</h2>
          {children}
          {footer && <div className="flex justify-end gap-2 pt-1">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

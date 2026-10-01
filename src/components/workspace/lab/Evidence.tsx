"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { AffixInput, Alert, Badge, Button, Field, Modal, Select, TextInput, cx } from "@/components/ui";
import { date, dateTime, money, moneyShort } from "@/lib/format";
import { METRICS, PROPERTY_TYPES, freshness, metricDef } from "@/lib/market/metrics";
import type { Workspace } from "@/lib/services/assessments";

export type PropertyType = "house" | "unit" | "townhouse" | "all";
export type LookupResult = { provider: string; status: string; message: string; saved: number };
export type EvidenceRow = Workspace["evidence"][number];

export const today = () => new Date().toISOString().slice(0, 10);

export interface FormState {
  area: string;
  propertyType: PropertyType;
  metric: string;
  value: string;
  periodStart: string;
  periodEnd: string;
  observedAt: string;
  sourceDescription: string;
}

export const emptyForm = (area = "", propertyType: PropertyType = "all"): FormState => ({
  area,
  propertyType,
  metric: METRICS[0].key,
  value: "",
  periodStart: "",
  periodEnd: "",
  observedAt: today(),
  sourceDescription: "",
});

export const typeLabel = (t: string) => PROPERTY_TYPES.find((p) => p.value === t)?.label ?? t;
export const providerLabel = (p: string) => (p === "manual" ? "Manual" : p === "sample" ? "SAMPLE provider" : p);

/** Comparison format: abbreviated money, explicit periods and units. */
export function fmtEvidence(unit: string, value: string | number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (unit === "AUD") return moneyShort(Math.round(n * 100));
  if (unit === "AUD/week") return `${money(Math.round(n * 100))}/wk`;
  if (unit === "%") return `${n}%`;
  if (unit === "days") return `${n} days`;
  return n.toLocaleString("en-AU");
}

/* ─────────────────────────────── Manual evidence form ─────────────────────────────── */

export type ManualBody = { area: string; propertyType: PropertyType; metric: string; value: number; periodEnd: string; periodStart?: string; sourceDescription: string; observedAt: string };

const AFFIX: Record<string, { prefix?: string; suffix?: string }> = { AUD: { prefix: "$" }, "AUD/week": { prefix: "$", suffix: "/wk" }, "%": { suffix: "%" }, days: { suffix: "days" }, count: { suffix: "sales" } };

export function ManualEvidenceForm({ form, setForm, knownAreas, onSubmit }: { form: FormState; setForm: Dispatch<SetStateAction<FormState>>; knownAreas: string[]; onSubmit: (body: ManualBody) => Promise<void> }) {
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [busy, setBusy] = useState(false);
  const def = metricDef(form.metric);
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const validate = () => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (form.area.trim().length < 2) e.area = "Area is required.";
    if (form.value.trim() === "" || !Number.isFinite(Number(form.value.replace(/,/g, "")))) e.value = "Enter a numeric value.";
    if (!dateRe.test(form.periodEnd)) e.periodEnd = "Period end date is required.";
    if (form.periodStart && !dateRe.test(form.periodStart)) e.periodStart = "Enter a valid date.";
    if (form.periodStart && dateRe.test(form.periodEnd) && form.periodStart > form.periodEnd) e.periodStart = "Period start must be on or before period end.";
    if (!dateRe.test(form.observedAt)) e.observedAt = "Observed / published date is required.";
    else if (form.observedAt > today()) e.observedAt = "Observed date cannot be in the future.";
    if (form.sourceDescription.trim().length < 3) e.sourceDescription = "A source is required for market evidence (at least 3 characters).";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const err = (k: keyof FormState, id: string) => ({ invalid: !!errors[k], "aria-describedby": errors[k] ? `${id}-error` : undefined });

  return (
    <section aria-label="Manual evidence" className="rounded-lg border border-line bg-surface p-5">
      <form
        className="grid gap-3.5 sm:grid-cols-2"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!validate()) return;
          setBusy(true);
          try {
            await onSubmit({
              area: form.area.trim(),
              propertyType: form.propertyType,
              metric: form.metric,
              value: Number(form.value.replace(/,/g, "")),
              periodEnd: form.periodEnd,
              ...(form.periodStart ? { periodStart: form.periodStart } : {}),
              sourceDescription: form.sourceDescription.trim(),
              observedAt: form.observedAt,
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex flex-col gap-1 sm:col-span-2">
          <h2 className="text-sm font-semibold text-ink">
            {def?.label ?? "Manual evidence"} · {form.area.trim() || "area"} · {typeLabel(form.propertyType)}
          </h2>
          <p className="text-xs text-muted">Manual evidence needs a value, unit, source and date. Asking prices are not achieved sales; advertised rents are not actual rents.</p>
        </div>
        <Field label={`Value${def ? ` (${def.unit})` : ""}`} htmlFor="ev-value" error={errors.value}>
          <AffixInput id="ev-value" inputMode="decimal" autoComplete="off" value={form.value} onChange={(e) => set("value", e.target.value)} {...AFFIX[def?.unit ?? ""]} {...err("value", "ev-value")} />
        </Field>
        <Field label="Period end" htmlFor="ev-pend" error={errors.periodEnd}>
          <TextInput id="ev-pend" type="date" value={form.periodEnd} onChange={(e) => set("periodEnd", e.target.value)} {...err("periodEnd", "ev-pend")} />
        </Field>
        <Field label="Source description" htmlFor="ev-source" error={errors.sourceDescription} hint="e.g. Agent sales report, Q2 2026, p. 4">
          <TextInput id="ev-source" value={form.sourceDescription} maxLength={300} placeholder="e.g. Agent sales report" onChange={(e) => set("sourceDescription", e.target.value)} {...err("sourceDescription", "ev-source")} />
        </Field>
        <Field label="Date observed" htmlFor="ev-observed" error={errors.observedAt} hint="When the figure was published or observed. Drives freshness.">
          <TextInput id="ev-observed" type="date" value={form.observedAt} max={today()} onChange={(e) => set("observedAt", e.target.value)} {...err("observedAt", "ev-observed")} />
        </Field>
        <Field label="Metric" htmlFor="ev-metric" hint={def ? `${def.help} Unit: ${def.unit}.` : undefined}>
          <Select id="ev-metric" value={form.metric} onChange={(e) => set("metric", e.target.value)} aria-describedby="ev-metric-hint">
            {METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label} ({m.unit})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Area" htmlFor="ev-area" error={errors.area}>
          <TextInput id="ev-area" list="ev-area-options" value={form.area} maxLength={80} onChange={(e) => set("area", e.target.value)} {...err("area", "ev-area")} />
          <datalist id="ev-area-options">
            {knownAreas.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </Field>
        <Field label="Property type" htmlFor="ev-type">
          <Select id="ev-type" value={form.propertyType} onChange={(e) => set("propertyType", e.target.value as PropertyType)}>
            {PROPERTY_TYPES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Period start (optional)" htmlFor="ev-pstart" error={errors.periodStart}>
          <TextInput id="ev-pstart" type="date" value={form.periodStart} onChange={(e) => set("periodStart", e.target.value)} {...err("periodStart", "ev-pstart")} />
        </Field>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Save evidence"}
          </Button>
          <Button
            type="button"
            variant="tertiary"
            disabled={busy}
            onClick={() => {
              setForm(emptyForm());
              setErrors({});
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}

/* ─────────────────────────────── Provider lookup ─────────────────────────────── */

export function LookupPanel({
  canEdit,
  provider,
  knownAreas,
  defaultType,
  onLookup,
  onEnterManually,
}: {
  canEdit: boolean;
  provider: string;
  knownAreas: string[];
  defaultType: PropertyType;
  onLookup: (area: string, propertyType: PropertyType) => Promise<LookupResult | undefined>;
  onEnterManually: (area: string, propertyType: PropertyType) => void;
}) {
  const [area, setArea] = useState("");
  const [propertyType, setPropertyType] = useState<PropertyType>(defaultType);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ r: LookupResult | null; area: string; type: PropertyType; at: string } | null>(null);

  const run = async (a: string, t: PropertyType) => {
    setBusy(true);
    setResult(null);
    try {
      const r = await onLookup(a, t);
      setResult({ r: r ?? null, area: a, type: t, at: new Date().toISOString() });
    } finally {
      setBusy(false);
    }
  };

  const failed = result && (!result.r || result.r.status === "provider_failure" || result.r.status === "access_denied");
  const tone = (r: LookupResult) => (r.status === "ok" && r.saved > 0 ? "ok" : r.status === "not_configured" ? "info" : "warn");
  const title = (r: LookupResult) =>
    r.status === "ok" && r.saved > 0 ? `${r.saved} metric${r.saved === 1 ? "" : "s"} saved from ${provider}` : r.status === "not_configured" ? "No market data provider configured — no search was performed" : `Lookup status: ${r.status.replaceAll("_", " ")}`;

  return (
    <section aria-label="Provider lookup" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-ink">Provider lookup</h2>
        <p className="text-xs text-muted">
          Provider: <span className="font-medium text-ink-secondary">{provider}</span>. Results are saved as dated evidence with their source.
        </p>
      </div>
      {canEdit ? (
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (area.trim().length < 2) return setError("Area is required.");
            setError(undefined);
            void run(area.trim(), propertyType);
          }}
        >
          <Field label="Area" htmlFor="lk-area" error={error}>
            <TextInput
              id="lk-area"
              list="lk-area-options"
              value={area}
              maxLength={80}
              invalid={!!error}
              aria-describedby={error ? "lk-area-error" : undefined}
              onChange={(e) => {
                setArea(e.target.value);
                if (error) setError(undefined);
              }}
            />
            <datalist id="lk-area-options">
              {knownAreas.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </Field>
          <Field label="Property type" htmlFor="lk-type">
            <Select id="lk-type" value={propertyType} onChange={(e) => setPropertyType(e.target.value as PropertyType)}>
              {PROPERTY_TYPES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:pt-[26px]">
            <Button type="submit" disabled={busy}>
              {busy ? "Looking up…" : "Look up"}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-[13px] text-muted">You have view-only access to this assessment.</p>
      )}
      {result && (
        <div aria-live="polite">
          {failed ? (
            <div role="alert" className="flex flex-wrap items-start gap-3 rounded-lg border border-line bg-surface px-5 py-4">
              <span aria-hidden="true" className="text-bad">
                ⚠︎
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-sm font-medium text-bad">Couldn’t retrieve data for {result.area}</span>
                <span className="text-[13px] text-ink-secondary">
                  {result.r?.message ? `${result.r.message} ` : "The market data provider returned an error. "}({dateTime(result.at)}) Values you entered manually are kept. No figures have been estimated in their place.
                </span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => void run(result.area, result.type)}>
                  Try again
                </Button>
                <Button size="sm" variant="tertiary" onClick={() => onEnterManually(result.area, result.type)}>
                  Enter manually
                </Button>
              </div>
            </div>
          ) : (
            result.r && (
              <Alert tone={tone(result.r)} title={title(result.r)}>
                {result.r.message}
              </Alert>
            )
          )}
        </div>
      )}
    </section>
  );
}

/* ─────────────────────────────── Evidence list (sources) ─────────────────────────────── */

export function EvidenceList({ evidence, canEdit, onDelete, onRefresh }: { evidence: EvidenceRow[]; canEdit: boolean; onDelete: (id: string) => Promise<unknown>; onRefresh: (e: EvidenceRow) => void }) {
  const [areaFilter, setAreaFilter] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<EvidenceRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const areas = useMemo(() => [...new Set(evidence.map((e) => e.area))].sort((a, b) => a.localeCompare(b)), [evidence]);
  const shown = areaFilter ? evidence.filter((e) => e.area === areaFilter) : evidence;

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <section aria-label="Evidence and sources" className="rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
        <h2 className="flex-1 text-base font-semibold text-ink">Evidence and sources ({evidence.length})</h2>
        {areas.length > 1 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ev-filter" className="text-xs text-muted">
              Area
            </label>
            <Select id="ev-filter" value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} className="!h-8 w-auto text-[13px]">
              <option value="">All areas</option>
              {areas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </div>
        )}
      </header>
      {evidence.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-ink-secondary">No market evidence recorded. Use the provider lookup or add dated manual evidence. Criteria without evidence show Unknown.</p>
      ) : (
        <ul>
          {shown.map((e) => {
            const fr = freshness(e.metric, e.observedAt);
            const label = metricDef(e.metric)?.label ?? e.metric;
            const isOpen = open.has(e.id);
            const drawerId = `ev-drawer-${e.id}`;
            return (
              <li key={e.id} className="border-b border-line-soft last:border-b-0">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 px-5 py-3">
                  <span className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
                    {label} · {typeLabel(e.propertyType)} · {e.area}
                    {e.isSample && (
                      <Badge tone="warn" icon={null}>
                        SAMPLE
                      </Badge>
                    )}
                  </span>
                  <span className="num text-right text-sm font-medium text-ink">{fmtEvidence(e.unit, e.valueNumeric)}</span>
                  <span className="text-[11px] text-muted">
                    {providerLabel(e.provider)} · {e.sourceDescription} · period to {date(e.periodEnd)} · observed {date(e.observedAt)}
                  </span>
                  <span className="text-right text-[11px] font-medium">
                    {fr.state === "stale" ? (
                      <span className="text-warn">
                        ⚠︎ {fr.ageDays} days old
                        {canEdit && (
                          <>
                            {" · "}
                            <button type="button" className="text-accent hover:underline" onClick={() => onRefresh(e)}>
                              refresh
                            </button>
                          </>
                        )}
                      </span>
                    ) : fr.state === "fresh" ? (
                      <span className="text-ok" title={`Within the ${fr.thresholdDays}-day threshold`}>
                        ✓ {fr.ageDays} days old
                      </span>
                    ) : (
                      <span className="text-muted">{fr.ageDays} days old</span>
                    )}
                  </span>
                  <div className="col-span-2 flex gap-1 pt-1">
                    <Button size="xs" variant="tertiary" aria-expanded={isOpen} aria-controls={drawerId} onClick={() => toggle(e.id)}>
                      {isOpen ? "Hide source" : "Source"}
                    </Button>
                    {canEdit && (
                      <Button size="xs" variant="ghost" onClick={() => setConfirm(e)} aria-label={`Delete ${label} for ${e.area}`}>
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
                {isOpen && (
                  <dl id={drawerId} className="mx-5 mb-3 grid gap-x-6 gap-y-1 rounded bg-subtle px-4 py-3 text-xs sm:grid-cols-[auto_1fr]">
                    <dt className="text-muted">Source description</dt>
                    <dd className="text-ink">{e.sourceDescription}</dd>
                    <dt className="text-muted">Provider</dt>
                    <dd className="text-ink">{providerLabel(e.provider)}</dd>
                    <dt className="text-muted">Provider record reference</dt>
                    <dd className="break-all text-ink">{e.providerRecordRef ?? "— (manual entry)"}</dd>
                    <dt className="text-muted">Period</dt>
                    <dd className="text-ink">To {date(e.periodEnd)}</dd>
                    <dt className="text-muted">Retrieved / recorded at</dt>
                    <dd className="text-ink">{dateTime(e.retrievedAt)}</dd>
                    <dt className="text-muted">Freshness rule</dt>
                    <dd className="text-ink">{fr.thresholdDays != null ? `Fresh if observed within ${fr.thresholdDays} days` : "No threshold configured — age shown only"}</dd>
                    {metricDef(e.metric)?.help && (
                      <>
                        <dt className="text-muted">Metric note</dt>
                        <dd className="text-ink">{metricDef(e.metric)?.help}</dd>
                      </>
                    )}
                    {e.isSample && (
                      <>
                        <dt className="text-muted">Sample data</dt>
                        <dd className="text-warn">Development fixture — not production evidence; excluded from client reports.</dd>
                      </>
                    )}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Modal
        open={!!confirm}
        onClose={() => !deleting && setConfirm(null)}
        title="Delete evidence?"
        footer={
          <>
            <Button disabled={deleting} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={deleting}
              onClick={async () => {
                if (!confirm) return;
                setDeleting(true);
                try {
                  await onDelete(confirm.id);
                } finally {
                  setDeleting(false);
                  setConfirm(null);
                }
              }}
            >
              {deleting ? "Deleting…" : "Delete evidence"}
            </Button>
          </>
        }
      >
        {confirm && (
          <p className={cx("text-[13px] text-ink-secondary")}>
            Delete the {metricDef(confirm.metric)?.label ?? confirm.metric} evidence for {confirm.area} ({fmtEvidence(confirm.unit, confirm.valueNumeric)}, observed {date(confirm.observedAt)})? Reports that cite it block deletion. This cannot be undone.
          </p>
        )}
      </Modal>
    </section>
  );
}

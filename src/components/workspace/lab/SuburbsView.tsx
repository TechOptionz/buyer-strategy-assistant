"use client";

import { useMemo, useRef, useState } from "react";
import { Alert, Button, cx, EmptyState, Segmented } from "@/components/ui";
import { api } from "@/lib/client/api";
import { date } from "@/lib/format";
import type { AreaFit, FitOutcome } from "@/lib/market/fit";
import { METRICS, freshness } from "@/lib/market/metrics";
import { useWs } from "../context";
import { get } from "../derive";
import { emptyForm, EvidenceList, fmtEvidence, LookupPanel, ManualEvidenceForm, providerLabel, typeLabel, type EvidenceRow, type FormState, type LookupResult, type PropertyType } from "./Evidence";
import { DashedChip, LabToolbar } from "./shared";

const MAX_RESEARCH_AREAS = 3;
const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const SEGMENTS: { value: PropertyType; label: string }[] = [
  { value: "house", label: "House" },
  { value: "townhouse", label: "Townhouse" },
  { value: "unit", label: "Unit" },
  { value: "all", label: "All" },
];
const FIT: Record<FitOutcome, { text: string; cls: string }> = {
  meets: { text: "✓ Meets", cls: "text-ok" },
  partly_meets: { text: "◐ Partly meets", cls: "text-warn" },
  does_not_meet: { text: "✕ Does not meet", cls: "text-bad" },
  unknown: { text: "? Unknown", cls: "text-muted" },
};

export function SuburbsView() {
  const { ws, mutate, goTab } = useWs();
  const canEdit = ws.permissions.canEdit;
  const url = `/api/assessments/${ws.assessment.id}/market`;

  const confirmedAreas = useMemo(() => {
    const f = ws.profile.confirmed["preferences.areas"];
    return f && f.state === "value" ? asStrings(f.value) : [];
  }, [ws.profile.confirmed]);
  const excludedAreas = useMemo(() => {
    const f = ws.profile.confirmed["preferences.excludedAreas"];
    return f && f.state === "value" ? asStrings(f.value) : [];
  }, [ws.profile.confirmed]);
  const researchAreas = ws.assessment.research.areas.map((a) => a.name);
  const knownAreas = [...new Set([...ws.fits.map((f) => f.area), ...confirmedAreas, ...researchAreas, ...ws.evidence.map((e) => e.area)])];
  const chipAreas = [...new Set([...ws.fits.map((f) => f.area), ...confirmedAreas, ...researchAreas])];
  const isResearch = (a: string) => researchAreas.some((r) => r.toLowerCase() === a.toLowerCase());
  const isConfirmed = (a: string) => confirmedAreas.some((r) => r.toLowerCase() === a.toLowerCase());
  const areaFitReadiness = ws.readiness.find((r) => r.output === "area_fit");

  const profileType = get<string>(ws, "preferences.propertyType");
  const fitType: PropertyType = profileType === "house" || profileType === "unit" || profileType === "townhouse" ? profileType : "all";
  const [segment, setSegment] = useState<PropertyType>(fitType);

  const [form, setForm] = useState<FormState>(() => emptyForm("", fitType));
  const formRef = useRef<HTMLDivElement>(null);
  const prefill = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => document.getElementById(patch.area ? "ev-value" : "ev-area")?.focus(), 50);
  };

  const active = ws.fits.filter((f) => !f.excluded);
  const excludedFits = ws.fits.filter((f) => f.excluded);
  const saveAreas = (areas: string[]) => mutate("Saving research areas", () => api(url, { body: { action: "areas", areas } }));

  const shownEvidence = ws.evidence.filter((e) => active.some((f) => f.area.toLowerCase() === e.area.toLowerCase()) && (segment === "all" || e.propertyType === segment));
  const anySample = shownEvidence.some((e) => e.isSample);
  const extraExcluded = excludedAreas.filter((a) => !excludedFits.some((f) => f.area.toLowerCase() === a.toLowerCase()));

  return (
    <div className="flex flex-1 flex-col">
      <LabToolbar className="flex-wrap">
        <AreaChips
          areas={chipAreas}
          isResearch={isResearch}
          isConfirmed={isConfirmed}
          researchAreas={researchAreas}
          canEdit={canEdit}
          onSave={saveAreas}
        />
        <span className="flex-1" />
        <span className="text-xs text-ink-secondary">Segment</span>
        <Segmented<PropertyType> label="Property type segment" value={segment} onChange={setSegment} options={SEGMENTS} />
      </LabToolbar>

      <div className="flex flex-col gap-4 px-4 py-6 md:px-8">
        {ws.goalConflicts.map((c) => (
          <Alert
            key={c.key}
            tone="warn"
            title="Goal conflict — a constraint needs to change"
            action={
              canEdit && (
                <Button size="sm" onClick={() => goTab("profile")}>
                  Change a constraint in the profile
                </Button>
              )
            }
          >
            <p>{c.description}</p>
            <p className="mt-1 text-xs">Constraints involved: {c.constraints.map((k) => k.label).join(", ")}. Nothing is relaxed automatically — confirm with the buyer which one can change.</p>
          </Alert>
        ))}

        {areaFitReadiness && areaFitReadiness.status !== "ready" && ws.fits.length > 0 && (
          <Alert tone={areaFitReadiness.status === "partial" ? "warn" : "bad"} title={`Area fit: ${areaFitReadiness.status === "partial" ? "partial" : "not ready"}`}>
            {areaFitReadiness.summary}
          </Alert>
        )}

        {anySample && (
          <div className="flex flex-wrap items-center gap-3 rounded border border-warn-line bg-warn-tint px-4 py-2.5">
            <span className="rounded border border-warn px-1.5 py-0.5 font-mono text-xs font-medium tracking-[0.06em] text-warn">SAMPLE DATA</span>
            <span className="flex-1 basis-[280px] text-[13px] text-warn-ink">
              <span className="md:hidden">Not market evidence.</span>
              <span className="max-md:hidden">Development fixture — not market evidence. Sample figures are excluded from client reports until replaced with provider data or dated manual entries.</span>
            </span>
            {canEdit && (
              <button type="button" className="text-[13px] font-medium text-accent hover:text-accent-hover hover:underline" onClick={() => prefill({})}>
                Enter values manually
              </button>
            )}
          </div>
        )}

        {ws.fits.length === 0 ? (
          <div className="rounded-lg border border-line bg-surface px-5">
            <EmptyState title="No suburbs to compare yet">
              Confirm the buyer&apos;s preferred areas in the interview, or add up to {MAX_RESEARCH_AREAS} research suburbs with “+ Add suburb”.
            </EmptyState>
          </div>
        ) : active.length === 0 ? (
          <p className="text-[13px] text-muted">Every candidate area is excluded by the buyer — nothing to compare.</p>
        ) : (
          <ComparisonTable fits={active} evidence={ws.evidence} segment={segment} fitType={fitType} isResearch={isResearch} isConfirmed={isConfirmed} canEdit={canEdit} onAdd={(area, metric) => prefill({ area, metric, propertyType: segment })} />
        )}

        {(excludedFits.length > 0 || extraExcluded.length > 0) && (
          <section aria-label="Excluded areas" className="rounded-lg border border-line bg-surface px-5 py-3.5">
            <h2 className="mb-1.5 text-xs font-medium text-muted">Excluded areas · the buyer wants to avoid</h2>
            <ul className="flex flex-col gap-1 text-[13px]">
              {excludedFits.map((f) => (
                <li key={f.area}>
                  <span className="font-medium text-bad">✕ {f.area}</span> <span className="text-ink-secondary">— {f.exclusionReason ?? "Excluded by the buyer."}</span>
                </li>
              ))}
              {extraExcluded.map((a) => (
                <li key={a}>
                  <span className="font-medium text-bad">✕ {a}</span> <span className="text-ink-secondary">— Listed by the buyer as an area to avoid.</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="grid items-start gap-4 xl:grid-cols-2">
          {canEdit && (
            <div ref={formRef} className="scroll-mt-4">
              <ManualEvidenceForm
                form={form}
                setForm={setForm}
                knownAreas={knownAreas}
                onSubmit={async (body) => {
                  const res = await mutate("Saving market evidence", () => api(url, { body: { action: "manual", evidence: body } }));
                  if (res !== undefined) setForm((f) => emptyForm(f.area, f.propertyType));
                }}
              />
            </div>
          )}
          <LookupPanel
            canEdit={canEdit}
            provider={ws.provider.label}
            knownAreas={knownAreas}
            defaultType={fitType}
            onLookup={(area, propertyType) => mutate("Looking up market data", () => api<LookupResult>(url, { body: { action: "lookup", lookup: { area, propertyType } } }))}
            onEnterManually={(area, propertyType) => prefill({ area, propertyType })}
          />
        </div>

        <EvidenceList
          evidence={ws.evidence}
          canEdit={canEdit}
          onDelete={(evidenceId) => mutate("Deleting evidence", () => api(url, { body: { action: "delete", evidenceId } }))}
          onRefresh={(e) => prefill({ area: e.area, metric: e.metric, propertyType: (["house", "unit", "townhouse", "all"].includes(e.propertyType) ? e.propertyType : "all") as PropertyType, value: "", sourceDescription: "" })}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────── Area chips + add ─────────────────────────────── */

function AreaChips({
  areas,
  isResearch,
  isConfirmed,
  researchAreas,
  canEdit,
  onSave,
}: {
  areas: string[];
  isResearch: (a: string) => boolean;
  isConfirmed: (a: string) => boolean;
  researchAreas: string[];
  canEdit: boolean;
  onSave: (areas: string[]) => Promise<unknown>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const full = researchAreas.length >= MAX_RESEARCH_AREAS;

  const save = async (next: string[]) => {
    setBusy(true);
    try {
      return await onSave(next);
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const name = draft.trim().replace(/\s+/g, " ");
    if (name.length < 2) return setError("Enter an area name (at least 2 characters).");
    if (name.length > 80) return setError("Area names are limited to 80 characters.");
    if (researchAreas.some((a) => a.toLowerCase() === name.toLowerCase())) return setError(`${name} is already a research area.`);
    if (full) return setError(`Up to ${MAX_RESEARCH_AREAS} research areas. Remove one first.`);
    setError(undefined);
    const res = await save([...researchAreas, name]);
    if (res !== undefined) {
      setDraft("");
      setAdding(false);
    }
  };

  return (
    <>
      {areas.map((a) => (
        <span key={a} className="flex h-[30px] shrink-0 items-center gap-2 rounded border border-line-strong bg-surface px-2.5 text-[13px] text-ink" title={isConfirmed(a) ? "Client preferred — remove it in the profile" : "Added by agent"}>
          {a}
          {canEdit && isResearch(a) && !isConfirmed(a) && (
            <button type="button" disabled={busy} onClick={() => void save(researchAreas.filter((x) => x !== a))} className="text-muted hover:text-bad disabled:opacity-50" aria-label={`Remove research area ${a}`}>
              ×
            </button>
          )}
        </span>
      ))}
      {canEdit &&
        (adding ? (
          <form
            className="flex shrink-0 flex-wrap items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <label htmlFor="research-area-new" className="sr-only">
              Add research suburb
            </label>
            <input
              id="research-area-new"
              autoFocus
              value={draft}
              maxLength={80}
              placeholder="Suburb, e.g. Ascot Vale VIC"
              aria-invalid={!!error || undefined}
              aria-describedby={error ? "research-area-new-error" : undefined}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(undefined);
              }}
              onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
              className={cx("h-[30px] w-52 rounded border bg-surface px-2.5 text-[13px] text-ink placeholder:text-faint focus:outline-2 focus:outline-offset-1 focus:outline-accent", error ? "border-bad" : "border-line-strong")}
            />
            <Button type="submit" size="xs" variant="primary" disabled={busy}>
              Add
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setError(undefined);
              }}
            >
              Cancel
            </Button>
            {error && (
              <span id="research-area-new-error" role="alert" className="basis-full text-xs text-bad">
                ⚠︎ {error}
              </span>
            )}
          </form>
        ) : (
          <DashedChip disabled={full} onClick={() => setAdding(true)} title={full ? `Up to ${MAX_RESEARCH_AREAS} research areas. Remove one first.` : undefined}>
            + Add suburb
          </DashedChip>
        ))}
      {canEdit && full && !adding && <span className="text-[11px] text-muted">{MAX_RESEARCH_AREAS}/{MAX_RESEARCH_AREAS} research areas</span>}
    </>
  );
}

/* ─────────────────────────────── Comparison table ─────────────────────────────── */

function latestFor(evidence: EvidenceRow[], area: string, metric: string, segment: PropertyType) {
  const m = evidence.filter((e) => e.area.toLowerCase() === area.toLowerCase() && e.metric === metric && (segment === "all" || e.propertyType === segment));
  return m.sort((a, b) => +new Date(b.periodEnd) - +new Date(a.periodEnd) || +new Date(b.observedAt) - +new Date(a.observedAt))[0];
}

function ComparisonTable({
  fits,
  evidence,
  segment,
  fitType,
  isResearch,
  isConfirmed,
  canEdit,
  onAdd,
}: {
  fits: AreaFit[];
  evidence: EvidenceRow[];
  segment: PropertyType;
  fitType: PropertyType;
  isResearch: (a: string) => boolean;
  isConfirmed: (a: string) => boolean;
  canEdit: boolean;
  onAdd: (area: string, metric: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const segLabel = segment === "all" ? "All dwellings" : typeLabel(segment);

  const metricRows = METRICS.map((m) => {
    const cells = fits.map((f) => latestFor(evidence, f.area, m.key, segment));
    const found = cells.filter((c): c is EvidenceRow => !!c);
    const latestEnd = found.map((e) => e.periodEnd).sort().at(-1);
    const sources = [...new Set(found.map((e) => providerLabel(e.provider)))];
    const basis = found.length ? [segLabel, latestEnd ? `period to ${date(latestEnd)}` : null, sources.join(", "), found.some((e) => e.isSample) ? "SAMPLE" : null].filter(Boolean).join(" · ") : `${segLabel} · ${m.help}`;
    return { key: m.key, label: m.label, basis, cells };
  });

  const fitRows = useMemo(() => {
    const map = new Map<string, { key: string; label: string; basedOn: Set<string>; threshold?: string }>();
    for (const f of fits)
      for (const c of f.criteria) {
        const r = map.get(c.key) ?? { key: c.key, label: c.label, basedOn: new Set<string>(), threshold: c.threshold };
        r.basedOn.add(c.basedOn);
        map.set(c.key, r);
      }
    return [...map.values()];
  }, [fits]);

  const shown = evidence.filter((e) => fits.some((f) => f.area.toLowerCase() === e.area.toLowerCase()) && (segment === "all" || e.propertyType === segment));
  const latestEnd = shown.map((e) => e.periodEnd).sort().at(-1);
  const latestRetrieved = shown.map((e) => e.retrievedAt).sort().at(-1);
  const providers = [...new Set(shown.map((e) => (e.isSample ? "SAMPLE provider (development fixture)" : providerLabel(e.provider))))];

  const colCls = (i: number) => cx("border-l border-line-soft", hover === i && "bg-accent-wash");
  const hoverProps = (i: number) => ({ onMouseEnter: () => setHover(i) });

  return (
    <section aria-label="Suburb comparison" className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="overflow-x-auto" onMouseLeave={() => setHover(null)}>
        <table className="w-full border-collapse md:table-fixed">
          <caption className="sr-only">Suburb comparison: metrics as rows, suburbs as columns. Each row names its segment, period and source.</caption>
          <thead>
            <tr className="border-b border-line bg-subtle">
              <th scope="col" className="sticky left-0 z-10 w-[132px] border-r border-line bg-subtle px-3 py-3 text-left align-bottom text-xs font-medium text-muted md:w-[300px] md:border-r-0 md:px-5">
                <span className="md:hidden">{fits.length > 2 ? `2 of ${fits.length} · swipe ›` : "Metric"}</span>
                <span className="max-md:hidden">Metric · segment · period · source</span>
              </th>
              {fits.map((f, i) => (
                <th key={f.area} scope="col" {...hoverProps(i)} className={cx("min-w-[124px] px-3 py-3 text-right align-bottom md:px-4", colCls(i))}>
                  <span className="block text-sm font-semibold text-ink">{f.area}</span>
                  <span className="block text-xs font-normal text-muted">{isConfirmed(f.area) ? "client preferred" : isResearch(f.area) ? "added by agent" : "candidate"}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricRows.map((r) => (
              <tr key={r.key} className="border-b border-line-soft">
                <th scope="row" className="sticky left-0 z-10 border-r border-line bg-subtle px-3 py-2.5 text-left font-normal md:border-r-0 md:bg-surface md:px-5">
                  <span className="block text-[13px] font-medium text-ink">{r.label}</span>
                  <span className="block text-[11px] text-muted">{r.basis}</span>
                </th>
                {r.cells.map((e, i) => {
                  const area = fits[i].area;
                  if (!e)
                    return (
                      <td key={area} {...hoverProps(i)} className={cx("px-3 py-2.5 text-right md:px-4", colCls(i))}>
                        <span className="block text-sm font-medium text-muted">—</span>
                        {canEdit ? (
                          <button type="button" onClick={() => onAdd(area, r.key)} className="text-[11px] text-muted hover:text-accent hover:underline" aria-label={`Add ${r.label} for ${area}`}>
                            No evidence · add
                          </button>
                        ) : (
                          <span className="block text-[11px] text-muted">No evidence</span>
                        )}
                      </td>
                    );
                  const fr = freshness(e.metric, e.observedAt);
                  const sub = fr.state === "stale" ? `⚠︎ ${fr.ageDays} days old` : segment === "all" && e.propertyType !== "all" ? typeLabel(e.propertyType) : e.isSample ? "SAMPLE" : "";
                  return (
                    <td key={area} {...hoverProps(i)} title={`${e.sourceDescription} · observed ${date(e.observedAt)}`} className={cx("px-3 py-2.5 text-right md:px-4", colCls(i))}>
                      <span className="num block text-[15px] font-medium text-ink md:text-sm">{fmtEvidence(e.unit, e.valueNumeric)}</span>
                      {sub && <span className={cx("block text-[11px]", fr.state === "stale" ? "font-medium text-warn" : "text-muted")}>{sub}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            {fitRows.map((r) => (
              <tr key={r.key} className="border-b border-line-soft bg-subtle">
                <th scope="row" className="sticky left-0 z-10 border-r border-line bg-subtle px-3 py-2.5 text-left font-normal md:border-r-0 md:px-5">
                  <span className="block text-[13px] font-semibold text-ink">{r.label}</span>
                  <span className="block text-[11px] text-muted">
                    {[...r.basedOn].join("; ")}
                    {r.threshold && ` · ${r.threshold}`}
                  </span>
                </th>
                {fits.map((f, i) => {
                  const c = f.criteria.find((x) => x.key === r.key);
                  return (
                    <td key={f.area} {...hoverProps(i)} className={cx("px-3 py-2.5 text-right align-top md:px-4", colCls(i))}>
                      {c ? (
                        <>
                          <span className={cx("block text-sm font-medium", FIT[c.outcome].cls)}>{FIT[c.outcome].text}</span>
                          <span className="line-clamp-3 text-[11px] text-ink-secondary" title={c.reason}>
                            {c.reason}
                          </span>
                        </>
                      ) : (
                        <span className="text-[11px] text-muted">Not assessed for this area</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="bg-subtle px-5 py-3 text-xs leading-relaxed text-ink-secondary">
        <span className="font-medium">Basis:</span> {segment === "all" ? "All property types" : typeLabel(segment)}
        {latestEnd ? ` · periods to ${date(latestEnd)}` : " · no evidence in this segment yet"}
        {providers.length > 0 && ` · ${providers.join(", ")}`}
        {latestRetrieved && ` · retrieved ${date(latestRetrieved)}`}. Fit rows use the confirmed property type ({fitType === "all" ? "any" : typeLabel(fitType)}) and are not changed by the segment filter. Suburb yields describe the area, not this property’s cashflow. Past price change is context, not a growth assumption.
        {" "}Asking prices are not achieved sales; advertised rents are not actual rents.
      </p>
    </section>
  );
}

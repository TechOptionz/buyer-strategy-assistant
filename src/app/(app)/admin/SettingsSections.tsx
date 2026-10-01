"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Alert, Badge, Button, Field, TextArea, TextInput, human } from "@/components/ui";
import { Panel, TD, TH, TitleRow, TONE_TEXT, useSettingsSave, type AdminProps, type TextTone } from "./shared";

/* ---------------------------------- Branding ---------------------------------- */

export function BrandingSection({ settings, saved, title }: { settings: AdminProps["settings"]; saved: ReactNode; title: string }) {
  const [baseline, setBaseline] = useState({ brandName: settings.brandName, reportFooter: settings.reportFooter, attribution: settings.attribution });
  const [brandName, setBrandName] = useState(settings.brandName);
  const [reportFooter, setReportFooter] = useState(settings.reportFooter);
  const [attribution, setAttribution] = useState(settings.attribution);
  const { saving, ok, err, save, setErr } = useSettingsSave();
  const dirty = brandName !== baseline.brandName || reportFooter !== baseline.reportFooter || attribution !== baseline.attribution;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!brandName.trim()) {
      setErr({ message: "Please fix the highlighted fields.", fieldErrors: { brandName: "Organisation name is required" } });
      return;
    }
    const next = { brandName: brandName.trim(), reportFooter, attribution };
    if (await save(next, "Branding and report settings saved.")) {
      setBrandName(next.brandName);
      setBaseline(next);
    }
  }

  const fe = err?.fieldErrors ?? {};
  return (
    <>
      <TitleRow title={title} saved={saved} />
      <form onSubmit={submit} noValidate aria-busy={saving}>
        <Panel
          title="Branding · report PDF"
          aside={
            dirty ? (
              <span className="text-xs text-warn">
                <span aria-hidden="true">●</span> Unsaved changes
              </span>
            ) : null
          }
          footer={
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save branding"}
            </Button>
          }
        >
          <div className="flex flex-col gap-4 p-4 md:p-5">
            {ok && !dirty && (
              <Alert tone="ok" title="Saved">
                {ok}
              </Alert>
            )}
            {err && (
              <Alert tone="bad" title="Could not save">
                {err.message}
              </Alert>
            )}
            <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="flex h-24 flex-col items-center justify-center gap-1 rounded border border-dashed border-line-strong bg-subtle px-3 text-center text-xs text-muted">
                <span className="font-medium text-ink-secondary">Logo</span>
                <span>Logo upload not available yet</span>
              </div>
              <div className="flex flex-col gap-3.5">
                <Field label="Organisation name on report" htmlFor="brand-name" error={fe.brandName} hint="Shown in the report header and every page footer.">
                  <TextInput id="brand-name" value={brandName} maxLength={120} onChange={(e) => setBrandName(e.target.value)} invalid={!!fe.brandName} />
                </Field>
                <Field label="Data attribution" htmlFor="attribution" error={fe.attribution} hint="Required by licensed data sources · up to 500 characters.">
                  <TextArea id="attribution" value={attribution} maxLength={500} onChange={(e) => setAttribution(e.target.value)} invalid={!!fe.attribution} />
                </Field>
              </div>
              <Field
                label="Report footer"
                htmlFor="report-footer"
                error={fe.reportFooter}
                hint={
                  <>
                    Up to 300 characters, e.g. licence number. The standard &ldquo;Indicative only — not loan approval&rdquo; statement is always printed and cannot be removed.
                  </>
                }
              >
                <TextArea id="report-footer" value={reportFooter} maxLength={300} onChange={(e) => setReportFooter(e.target.value)} invalid={!!fe.reportFooter} />
              </Field>
            </div>
          </div>
        </Panel>
      </form>
    </>
  );
}

/* ---------------------------------- Retention ---------------------------------- */

export function RetentionSection({ retentionDays, saved, title }: { retentionDays: number | null; saved: ReactNode; title: string }) {
  const [value, setValue] = useState(retentionDays == null ? "" : String(retentionDays));
  const { saving, ok, err, save, setErr } = useSettingsSave();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (!value.trim() || !Number.isInteger(n) || n < 30 || n > 36_500) {
      setErr({ message: "Please fix the highlighted fields.", fieldErrors: { retentionDays: "Enter a whole number of days between 30 and 36500" } });
      return;
    }
    await save({ retentionDays: n }, `Retention period set to ${n.toLocaleString("en-AU")} days.`);
  }

  const fe = err?.fieldErrors ?? {};
  return (
    <>
      <TitleRow title={title} saved={saved} />
      <form onSubmit={submit} noValidate aria-busy={saving}>
        <Panel
          title="Data retention"
          aside={
            <span className="text-xs text-muted">
              Current: <span className="font-medium text-ink-2">{retentionDays == null ? "Not set" : `${retentionDays.toLocaleString("en-AU")} days`}</span>
            </span>
          }
          footer={
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save retention"}
            </Button>
          }
        >
          <div className="flex flex-col gap-4 p-4 md:p-5">
            <p className="max-w-[640px] text-[13px] leading-relaxed text-ink-secondary">
              Applies to conversations, documents, extracted data and exports. Confirm the retention period with your compliance owner before using real buyer records. Audit retention requirements may override deletion.
            </p>
            {ok && (
              <Alert tone="ok" title="Saved">
                {ok}
              </Alert>
            )}
            {err && (
              <Alert tone="bad" title="Could not save">
                {err.message}
              </Alert>
            )}
            <Field label="Retention period (days)" htmlFor="retention-days" error={fe.retentionDays} hint="Between 30 and 36,500 days." className="max-w-60">
              <TextInput id="retention-days" type="number" inputMode="numeric" min={30} max={36500} step={1} className="num text-right" value={value} onChange={(e) => setValue(e.target.value)} invalid={!!fe.retentionDays} />
            </Field>
          </div>
        </Panel>
      </form>
    </>
  );
}

/* ------------------------------ Data providers + freshness ------------------------------ */

const SAMPLE_PROVIDER = /sample|fixture|mock|demo|fake/i;

export function ProvidersSection({
  ai,
  marketProvider,
  metrics,
  freshnessDays,
  saved,
  title,
}: {
  ai: AdminProps["ai"];
  marketProvider: AdminProps["marketProvider"];
  metrics: AdminProps["metrics"];
  freshnessDays: Record<string, number>;
  saved: ReactNode;
  title: string;
}) {
  const sample = marketProvider.configured && SAMPLE_PROVIDER.test(marketProvider.id);
  const rows: { name: string; status: string; tone: TextTone; note: string }[] = [
    {
      name: "Manual evidence",
      status: "✓ Active",
      tone: "ok",
      note: "Value, unit, source and date required · freshness thresholds below",
    },
    marketProvider.configured
      ? sample
        ? { name: marketProvider.label, status: "⚠︎ Development only", tone: "warn", note: "Every figure labelled SAMPLE DATA · excluded from reports" }
        : { name: marketProvider.label, status: "✓ Configured", tone: "ok", note: `Licensed market data adapter · ${marketProvider.id}` }
      : {
          name: "Market data provider",
          status: "— Not configured",
          tone: "muted",
          note: "No licensed provider connected · the exact product and usage rights must be confirmed first",
        },
    ai.configured
      ? { name: "AI extraction service", status: "✓ Configured", tone: "ok", note: `${human(ai.provider)} · ${ai.model ?? "model not set"}` }
      : { name: "AI extraction service", status: "— Not configured", tone: "muted", note: "Set ANTHROPIC_API_KEY on the server · manual and rule-based paths work without it" },
  ];

  return (
    <>
      <TitleRow title={title} saved={saved} />
      <Panel title="Data providers" aside={<span className="text-xs text-muted">Credentials are server environment variables and are never displayed</span>}>
        <ul>
          {rows.map((r) => (
            <li key={r.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b border-line-soft px-4 py-3 last:border-b-0 md:px-5">
              <span className="text-[13px] font-medium text-ink">{r.name}</span>
              <span className={`text-right text-xs font-medium ${TONE_TEXT[r.tone]}`}>{r.status}</span>
              <span className="col-span-2 text-xs text-muted">{r.note}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <FreshnessPanel metrics={metrics} freshnessDays={freshnessDays} />
    </>
  );
}

function FreshnessPanel({ metrics, freshnessDays }: { metrics: AdminProps["metrics"]; freshnessDays: Record<string, number> }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(metrics.map((m) => [m.key, String(freshnessDays[m.key] ?? m.defaultFreshDays ?? "")])));
  const { saving, ok, err, save, setErr } = useSettingsSave();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const out: Record<string, number> = {};
    const errors: Record<string, string> = {};
    for (const m of metrics) {
      const raw = (values[m.key] ?? "").trim();
      if (!raw) continue; // leave unset: age shown without a freshness claim
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 3650) errors[m.key] = "Enter a whole number of days between 1 and 3650";
      else out[m.key] = n;
    }
    if (Object.keys(errors).length) {
      setErr({ message: "Please fix the highlighted thresholds.", fieldErrors: errors });
      return;
    }
    await save({ freshnessDays: out }, "Evidence freshness thresholds saved.");
  }

  const fe = err?.fieldErrors ?? {};
  return (
    <form onSubmit={submit} noValidate aria-busy={saving} id="freshness">
      <Panel
        title="Evidence freshness"
        aside={<span className="text-xs text-muted">Older evidence is labelled stale</span>}
        footer={
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save thresholds"}
          </Button>
        }
      >
        <div className="flex flex-col gap-4 p-4 md:p-5">
          <p className="text-[13px] text-ink-secondary">Evidence older than its threshold is labelled stale. A blank threshold shows the evidence age without claiming it is fresh.</p>
          {ok && (
            <Alert tone="ok" title="Saved">
              {ok}
            </Alert>
          )}
          {err && (
            <Alert tone="bad" title="Could not save">
              {err.message}
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((m) => (
              <Field key={m.key} label={m.label} htmlFor={`fresh-${m.key}`} error={fe[m.key]} hint={`${m.help} Default: ${m.defaultFreshDays == null ? "none" : `${m.defaultFreshDays} days`}.`}>
                <TextInput
                  id={`fresh-${m.key}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={3650}
                  step={1}
                  className="num text-right"
                  value={values[m.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [m.key]: e.target.value }))}
                  invalid={!!fe[m.key]}
                />
              </Field>
            ))}
          </div>
        </div>
      </Panel>
    </form>
  );
}

/* ---------------------------------- Interview ---------------------------------- */

export function InterviewSection({ interview, title }: { interview: AdminProps["interview"]; title: string }) {
  const questions = [...interview.questions].sort((a, b) => a.priority - b.priority);
  return (
    <>
      <TitleRow title={title} />
      <Panel
        title={`Question registry · ${interview.version}`}
        aside={
          <span className="text-xs text-muted">
            {interview.questions.length} questions · read-only in this release
          </span>
        }
      >
        <div className="max-h-[640px] overflow-auto">
          <table className="w-full min-w-[900px] border-collapse text-[13px]">
            <caption className="sr-only">Interview questions</caption>
            <thead className="sticky top-0 z-[1]">
              <tr>
                <th scope="col" className={`${TH} text-right`}>
                  #
                </th>
                <th scope="col" className={TH}>
                  Key
                </th>
                <th scope="col" className={TH}>
                  Topic
                </th>
                <th scope="col" className={TH}>
                  Prompt
                </th>
                <th scope="col" className={TH}>
                  Answer type
                </th>
                <th scope="col" className={TH}>
                  Required for
                </th>
                <th scope="col" className={TH}>
                  Optional
                </th>
              </tr>
            </thead>
            <tbody>
              {questions.map((q) => (
                <tr key={q.key} className="hover:bg-hover">
                  <td className={`${TD} num text-right text-muted`}>{q.priority}</td>
                  <th scope="row" className={`${TD} text-left font-normal`}>
                    <span className="font-mono text-xs text-ink-2">{q.key}</span>
                    {q.perProperty && <span className="mt-0.5 block text-xs text-muted">Per property</span>}
                  </th>
                  <td className={`${TD} text-ink-2`}>{human(q.topic)}</td>
                  <td className={`${TD} max-w-[360px] text-ink`}>{q.prompt}</td>
                  <td className={`${TD} text-muted`}>{human(q.answerType)}</td>
                  <td className={TD}>
                    {q.requiredFor.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {q.requiredFor.map((o) => (
                          <Badge key={o} tone="neutral" icon={null}>
                            {o}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className={`${TD} ${q.optional ? "text-ink-2" : "text-muted"}`}>{q.optional ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

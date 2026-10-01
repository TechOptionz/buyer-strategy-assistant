"use client";

import { useState } from "react";
import { Button, cx } from "@/components/ui";
import { api } from "@/lib/client/api";
import { applyChanges, type ScenarioChange } from "@/lib/finance/patch";
import { rate } from "@/lib/format";
import { useWs } from "../context";
import { inputsOf, type Scn } from "../derive";
import { changeNote, inputDiffRows, nameFor } from "./shared";

type Proposal = {
  changes: ScenarioChange[];
  clarifications: { question: string; options: { label: string; changes: ScenarioChange[] }[] }[];
  unrecognised: string[];
  source: "text" | "downside";
};

const FIELD_OF: Record<ScenarioChange["op"], string> = {
  rate_add_pp: "rate",
  rate_scale_relative_pct: "rate",
  set_rate: "rate",
  set_weekly_rent: "rent",
  rent_scale_relative_pct: "rent",
  set_vacant_weeks: "vacant",
  set_price: "price",
  set_valuation: "valuation",
  valuation_scale_relative_pct: "valuation",
  set_purchase_loan: "loan",
  set_deposit: "loan",
  set_equity_draw: "equity",
  add_annual_cost: "opcosts",
  set_repayment: "repayment",
};

/** ANA02: natural language → proposed change list, shown before anything is calculated. */
export function WhatIfPanel({
  s,
  onRun,
  onEdit,
  busy,
  className,
}: {
  s: Scn;
  onRun: (changes: ScenarioChange[], name: string, kind: "alternative" | "downside") => void;
  onEdit: (changes: ScenarioChange[]) => void;
  busy: boolean;
  className?: string;
}) {
  const { ws } = useWs();
  const inputs = inputsOf(s);
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [choice, setChoice] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [interpreting, setInterpreting] = useState(false);

  const all = proposal ? [...proposal.changes, ...proposal.clarifications.flatMap((c, i) => (choice[i] != null ? c.options[choice[i]].changes : []))] : [];
  const unresolved = proposal ? proposal.clarifications.findIndex((_, i) => choice[i] == null) : -1;
  const nothing = !!proposal && proposal.source === "text" && all.length === 0 && proposal.clarifications.length === 0;
  const invalid = unresolved >= 0 || nothing;

  const applied = all.length ? applyChanges(inputs, all) : inputs;
  const rows = inputDiffRows(inputs, applied).map((r) => {
    const notes = all.filter((c) => FIELD_OF[c.op] === r.key).map(changeNote).filter(Boolean);
    return { ...r, note: notes.length ? notes.join("; ") : r.diff };
  });
  const name = proposal?.source === "downside" ? nameFor(all, "Downside") : nameFor(all);

  const interpret = async () => {
    if (!text.trim()) return;
    setInterpreting(true);
    setError(null);
    setChoice({});
    try {
      const p = await api<Omit<Proposal, "source">>(`/api/assessments/${ws.assessment.id}/scenarios`, { body: { action: "interpret", text } });
      setProposal({ changes: p.changes, clarifications: p.clarifications, unrecognised: p.unrecognised, source: "text" });
    } catch {
      setProposal(null);
      setError("Could not interpret that. Use the assumption controls instead.");
    } finally {
      setInterpreting(false);
    }
  };

  const downside = () => {
    const ch: ScenarioChange[] = [{ op: "rate_add_pp", pp: 2 }];
    if (inputs.rent) ch.push({ op: "rent_scale_relative_pct", pct: -10 });
    if (inputs.rent && inputs.rent.vacantWeeks != null) ch.push({ op: "set_vacant_weeks", weeks: inputs.rent.vacantWeeks + 2 });
    setChoice({});
    setError(null);
    setProposal({ changes: ch, clarifications: [], unrecognised: [], source: "downside" });
  };

  const discard = () => {
    setProposal(null);
    setChoice({});
    setError(null);
  };

  const optionLabel = (o: { label: string; changes: ScenarioChange[] }) => {
    const r = applyChanges(inputs, [...(proposal?.changes ?? []), ...o.changes]).purchaseLoan.ratePct;
    return o.changes.some((c) => FIELD_OF[c.op] === "rate") && r != null ? `${o.label} → ${rate(r, "%")}` : o.label;
  };

  return (
    <section aria-label="What if" className={cx("flex flex-col gap-3 rounded-lg border border-line bg-surface px-5 py-4", className)}>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void interpret();
        }}
      >
        <label htmlFor="wi-text" className="text-[13px] font-medium text-ink-secondary">
          What if…
        </label>
        <input
          id="wi-text"
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. rates go up 2 points and rent drops to $700 a week"
          aria-invalid={invalid || undefined}
          className={cx(
            "h-10 min-w-0 flex-1 basis-[240px] rounded border bg-surface px-3 text-sm text-ink placeholder:text-faint focus:outline-2 focus:outline-offset-1 focus:outline-accent max-lg:h-12 max-lg:text-base",
            invalid ? "border-bad" : "border-line-strong focus:border-accent",
          )}
        />
        <Button type="submit" className="h-10" disabled={!text.trim() || interpreting}>
          {interpreting ? "Interpreting…" : "Interpret"}
        </Button>
        <Button type="button" variant="tertiary" onClick={downside} title="Rate +2.00 pts, rent −10%, +2 vacant weeks">
          Downside case
        </Button>
      </form>

      {error && (
        <p role="alert" className="text-[13px] text-bad">
          ⚠︎ {error}
        </p>
      )}

      {proposal && nothing && (
        <p role="alert" className="text-[13px] text-bad">
          ⚠︎ No changes recognised.{proposal.unrecognised.length > 0 && ` Not understood: “${proposal.unrecognised.join("”, “")}”.`} Rephrase, or use the assumption controls.
        </p>
      )}

      {proposal?.clarifications.map((c, i) => (
        <div key={i} className="flex flex-col gap-2">
          <span className={cx("text-[13px]", choice[i] == null ? "text-bad" : "text-ink-secondary")}>
            {choice[i] == null && <span aria-hidden="true">⚠︎ </span>}
            {c.question} {choice[i] == null && "Choose one:"}
          </span>
          <div role="radiogroup" aria-label={c.question} className="flex flex-wrap gap-2">
            {c.options.map((o, j) => (
              <button
                key={j}
                type="button"
                role="radio"
                aria-checked={choice[i] === j}
                onClick={() => setChoice({ ...choice, [i]: j })}
                className={cx("h-8 rounded border px-3 text-[13px]", choice[i] === j ? "border-accent bg-accent-tint font-medium text-accent" : "border-line-strong bg-surface text-ink hover:bg-hover")}
              >
                {optionLabel(o)}
              </button>
            ))}
          </div>
        </div>
      ))}

      {proposal && !nothing && (
        <div className="flex flex-col gap-2 rounded border border-est-line bg-est-wash px-4 py-3">
          <span className="text-xs font-medium text-est">◐ Proposed changes · not yet calculated · applied to a copy of {s.name}</span>
          {rows.length > 0 ? (
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-x-2 gap-y-1.5 text-[13px] md:grid-cols-[200px_110px_24px_110px_1fr]">
              {rows.map((r) => (
                <div key={r.key} className="contents">
                  <span className="text-ink-secondary">{r.label}</span>
                  <span className="num text-right text-ink">{r.from}</span>
                  <span aria-hidden="true" className="text-center text-muted">
                    →
                  </span>
                  <span className="num text-right font-semibold text-ink">
                    <span className="sr-only">to </span>
                    {r.to}
                  </span>
                  <span className="text-xs text-ink-secondary max-md:col-span-4 max-md:-mt-1 max-md:mb-1">{r.note}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted">{unresolved >= 0 ? "Choose an option above to see the change." : "These changes do not alter any input of this scenario."}</p>
          )}
          {proposal.unrecognised.length > 0 && (
            <p className="text-xs text-warn">
              ⚠︎ Not understood: “{proposal.unrecognised.join("”, “")}”. Use the assumption controls for these.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="primary" size="sm" disabled={busy || !all.length || unresolved >= 0} onClick={() => onRun(all, name, proposal.source === "downside" ? "downside" : "alternative")}>
              Run as new scenario
            </Button>
            <Button
              variant="tertiary"
              size="sm"
              disabled={!all.length || unresolved >= 0}
              onClick={() => {
                onEdit(all);
                discard();
              }}
            >
              Edit changes
            </Button>
            <Button variant="ghost" size="sm" onClick={discard}>
              Discard
            </Button>
            <span className="flex-1" />
            {all.length > 0 && <span className="text-xs text-muted">Will be named “{name}”</span>}
          </div>
        </div>
      )}
    </section>
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";
import { Segmented } from "@/components/ui";
import { api } from "@/lib/client/api";
import { FIELDS, TOPIC_LABELS, type Topic } from "@/lib/profile/fields";
import { useWs } from "./context";
import type { Entry } from "./FieldEditor";
import { ProfileAside } from "./profile/Aside";
import { Highlights } from "./profile/Highlights";
import { FieldRow, LinkButton, ProfileUiCtx, Section, type ProfileUi } from "./profile/Row";
import { LoansSection, PropertiesSection } from "./profile/Tables";
import { isGap } from "./profile/util";
import { ValueDetails } from "./profile/ValueDetails";

const paths = (topic: Topic) => FIELDS.filter((f) => f.topic === topic).map((f) => f.path);

/** Label/value sections. Properties and loans are tables rendered separately. */
const FINANCIAL_POSITION = [
  "household.income.amount",
  "household.income.frequency",
  "household.income.basis",
  "household.income.type",
  "household.expenses.amount",
  "household.expenses.frequency",
  "household.currentLoanRepaymentsMonthly",
  "household.otherCommitmentsMonthly",
  "household.creditLimits",
  ...paths("funds"),
  ...paths("super"),
];
const FINANCE_GOALS = [...paths("finance"), ...paths("goals"), ...paths("preferences")];
const HOUSEHOLD = paths("household").filter((p) => !FINANCIAL_POSITION.includes(p));

const SECTIONS: { key: string; title: string; paths: string[] }[] = [
  { key: "finance", title: "Finance and purchase goals", paths: FINANCE_GOALS },
  { key: "household", title: TOPIC_LABELS.household, paths: HOUSEHOLD },
  { key: "scenario", title: TOPIC_LABELS.scenario, paths: paths("scenario") },
  { key: "case", title: TOPIC_LABELS.case, paths: paths("case") },
];

const SUPER_NOTE = "never counted as funding";

export function ProfileTab() {
  const { ws, mutate } = useWs();
  const [filter, setFilter] = useState<"all" | "gaps">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const canEdit = ws.permissions.canEdit;
  const gapsOnly = filter === "gaps";

  const addProperty = () => {
    const count = Number(ws.profile.confirmed["portfolio.propertyCount"]?.value ?? 0);
    return mutate("Add property", () =>
      api(`/api/assessments/${ws.assessment.id}/profile`, { method: "PATCH", body: { action: "set", expectedRevision: ws.assessment.currentRevision, fields: [{ path: "portfolio.propertyCount", valueState: "value", value: count + 1 }] } }),
    );
  };

  const saveField = useCallback(
    async (path: string, e: Entry) => {
      const ok = await mutate("Save field", () =>
        api(`/api/assessments/${ws.assessment.id}/profile`, { method: "PATCH", body: { action: "set", expectedRevision: ws.assessment.currentRevision, fields: [{ path, ...e }] } }),
      );
      return ok !== undefined;
    },
    [mutate, ws.assessment.id, ws.assessment.currentRevision],
  );

  const close = useCallback(() => setSelected(null), []);
  const ui = useMemo<ProfileUi>(() => ({ open: setSelected, selected, editing, setEditing, saveField }), [selected, editing, saveField]);

  const visible = (list: string[]) => (gapsOnly ? list.filter((p) => isGap(ws, p)) : list);
  const position = visible(FINANCIAL_POSITION);

  return (
    <ProfileUiCtx.Provider value={ui}>
      <div className="flex flex-col gap-6 px-4 py-6 md:px-8">
        <Highlights />

        <div className="flex flex-col gap-6 xl:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-[560px] text-[13px] text-ink-secondary">Every value shows its status and source. Select a value for its details and history; edits create a new revision.</p>
              <Segmented
                label="Filter fields"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All fields" },
                  { value: "gaps", label: "Gaps only" },
                ]}
              />
            </div>

            {position.length > 0 && <RowSection title="Financial position" list={position} canEdit={canEdit} />}

            <PropertiesSection gapsOnly={gapsOnly} onAdd={canEdit ? addProperty : undefined} />

            {!gapsOnly && <LoansSection />}

            {SECTIONS.map((s) => {
              const list = visible(s.paths);
              return list.length ? <RowSection key={s.key} title={s.title} list={list} canEdit={canEdit} /> : null;
            })}

            {gapsOnly && position.length === 0 && SECTIONS.every((s) => !visible(s.paths).length) && <p className="text-[13px] text-muted">No gaps outside existing properties.</p>}
          </div>

          <ProfileAside />
        </div>
      </div>
      {selected && <ValueDetails key={selected} path={selected} onClose={close} />}
    </ProfileUiCtx.Provider>
  );
}

function RowSection({ title, list, canEdit }: { title: string; list: string[]; canEdit: boolean }) {
  const [edit, setEdit] = useState(false);
  return (
    <Section title={title} actions={canEdit ? <LinkButton onClick={() => setEdit((e) => !e)}>{edit ? "Done" : "Edit section"}</LinkButton> : undefined}>
      {list.map((p) => (
        <FieldRow key={p} path={p} sectionEdit={edit} sourceNote={p === "super.balance" ? SUPER_NOTE : undefined} />
      ))}
    </Section>
  );
}

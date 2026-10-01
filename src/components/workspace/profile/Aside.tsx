"use client";

import type { ReactNode } from "react";
import { cx, Mark, REPORT_STATUS } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { labelFor } from "@/lib/profile/fields";
import { useWs } from "../context";
import { financeConfirmed, get } from "../derive";
import { useProfileUi } from "./Row";
import { activityText } from "./util";

function Panel({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

const linkCls = "flex min-w-0 gap-1.5 text-left text-[13px] text-accent hover:text-accent-hover hover:underline";
const MAX_REVIEW = 6;

export function ProfileAside() {
  const { ws, goTab } = useWs();
  const ui = useProfileUi();

  // Items needing review: conflicts, proposed (unconfirmed) facts, "not sure" answers, unconfirmed finance limit.
  const review: { key: string; icon: string; tone: string; text: string; path: string }[] = [];
  for (const [path, facts] of Object.entries(ws.profile.conflicts)) review.push({ key: `c:${path}`, icon: "⚠︎", tone: "text-warn", text: `${labelFor(path)} — ${facts.length} values disagree`, path });
  const proposedPaths = [...new Set(ws.profile.proposed.map((f) => f.fieldPath))].filter((p) => !ws.profile.conflicts[p]);
  for (const path of proposedPaths) review.push({ key: `p:${path}`, icon: "◐", tone: "text-est", text: `${labelFor(path)} — suggested, not confirmed`, path });
  for (const [path, c] of Object.entries(ws.profile.confirmed)) if (c.state === "value" && c.value === "not_sure") review.push({ key: `n:${path}`, icon: "⚠︎", tone: "text-warn", text: `${labelFor(path)} — not sure`, path });
  if (get(ws, "finance.borrowingLimit") != null && !financeConfirmed(ws) && !ws.profile.conflicts["finance.borrowingLimit"])
    review.push({ key: "limit", icon: "⚠︎", tone: "text-warn", text: "Borrowing limit — not lender confirmed", path: "finance.borrowingLimit" });

  const isSample = ws.evidence.some((e) => e.isSample);
  const report = ws.reports[0];
  const rs = report ? (REPORT_STATUS[report.status] ?? REPORT_STATUS.draft) : null;
  const toneCls: Record<string, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", info: "text-accent", neutral: "text-neutral", muted: "text-muted", est: "text-est" };

  return (
    <aside className="flex w-full flex-col gap-4 xl:w-[300px] xl:flex-none xl:self-start" aria-label="Review, related items and activity">
      <Panel title={review.length ? `${review.length} item${review.length === 1 ? "" : "s"} need${review.length === 1 ? "s" : ""} review` : "Nothing needs review"}>
        {!review.length && <Mark kind="confirmed" label="All recorded values are confirmed" />}
        {review.slice(0, MAX_REVIEW).map((r) => (
          <button key={r.key} type="button" className={linkCls} onClick={() => ui.open(r.path)}>
            <span aria-hidden="true" className={r.tone}>
              {r.icon}
            </span>
            <span className="min-w-0">{r.text}</span>
          </button>
        ))}
        {review.length > MAX_REVIEW && (
          <button type="button" className={linkCls} onClick={() => goTab("interview")}>
            {review.length - MAX_REVIEW} more in the Interview tab →
          </button>
        )}
      </Panel>

      <Panel title="Related">
        {ws.scenarios.length === 0 && (
          <div className="flex gap-2 text-[13px]">
            <button type="button" className={cx(linkCls, "flex-1")} onClick={() => goTab("scenarios")}>
              Scenario Lab
            </button>
            <span className="text-xs text-muted">No scenarios yet</span>
          </div>
        )}
        {ws.scenarios.map((s) => (
          <div key={s.id} className="flex items-center gap-2">
            <button type="button" className={cx(linkCls, "flex-1")} onClick={() => goTab("scenarios")}>
              <span className="truncate">{s.name}</span>
            </button>
            {s.staleBecause.length ? <Mark kind="stale" /> : <Mark kind="confirmed" label="Current" />}
          </div>
        ))}
        <div className="flex items-center gap-2">
          <button type="button" className={cx(linkCls, "flex-1")} onClick={() => goTab("research")}>
            Suburb comparison · {ws.fits.length}
          </button>
          {isSample && <span className="text-xs text-ink-secondary">SAMPLE</span>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={cx(linkCls, "flex-1")} onClick={() => goTab("report")}>
            {report ? `Report v${report.version}` : "Report"}
          </button>
          {rs ? (
            <span className={cx("text-xs font-medium", toneCls[rs.tone], report?.status === "superseded" && "line-through")}>
              {rs.icon && <span aria-hidden="true">{rs.icon} </span>}
              {rs.label}
            </span>
          ) : (
            <span className="text-xs text-muted">Not started</span>
          )}
        </div>
      </Panel>

      <Panel title="Recent activity">
        {!ws.activity.length && <span className="text-xs text-muted">No activity recorded yet.</span>}
        {ws.activity.slice(0, 5).map((a) => (
          <div key={a.id} className="flex flex-col gap-0.5 text-xs">
            <span className="text-ink-2">{activityText(a)}</span>
            <span className="text-muted">
              {(a.actorId ? ws.people[a.actorId] : null) ?? "System"} · {dateTime(a.createdAt)}
            </span>
          </div>
        ))}
      </Panel>
    </aside>
  );
}

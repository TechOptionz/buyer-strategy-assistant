"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { api, ClientApiError } from "@/lib/client/api";
import type { Workspace as WorkspaceData } from "@/lib/services/assessments";
import { ActivityTab } from "./ActivityTab";
import { CaseHeader } from "./CaseHeader";
import { WsContext, type LabView, type SaveState, type TabKey } from "./context";
import { InterviewTab } from "./InterviewTab";
import { ProfileTab } from "./ProfileTab";
import { ReportTab } from "./ReportTab";
import { ScenarioLab } from "./ScenarioLab";

type Toast = { tone: "ok" | "bad" | "info" | "warn"; text: string; id: number };

export function Workspace({ initial, initialTab, initialView, startNotes }: { initial: WorkspaceData; initialTab: TabKey; initialView: LabView; startNotes: boolean }) {
  const [ws, setWs] = useState(initial);
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [labView, setLabViewState] = useState<LabView>(initialView);
  const [save, setSave] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<string>(initial.assessment.updatedAt);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastFailed = useRef<(() => Promise<unknown>) | null>(null);

  const refresh = useCallback(async () => {
    const next = await api<WorkspaceData>(`/api/assessments/${ws.assessment.id}`);
    setWs((prev) => {
      const diff = new Set<string>();
      for (const [path, v] of Object.entries(next.profile.confirmed)) {
        const before = prev.profile.confirmed[path];
        if (!before || JSON.stringify(before.value) !== JSON.stringify(v.value) || before.state !== v.state) diff.add(path);
      }
      setChanged(diff);
      return next;
    });
  }, [ws.assessment.id]);

  const notify = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { tone, text, id }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000);
  }, []);

  const mutate = useCallback(
    async <T,>(label: string, fn: () => Promise<T>) => {
      setSave("saving");
      try {
        const result = await fn();
        await refresh();
        setSave("saved");
        setSavedAt(new Date().toISOString());
        lastFailed.current = null;
        return result;
      } catch (err) {
        if (err instanceof ClientApiError && err.status === 409) {
          await refresh().catch(() => undefined);
          setSave("saved");
          notify("warn", `${err.message} The latest version has been loaded.`);
          return undefined;
        }
        setSave("failed");
        lastFailed.current = fn;
        const msg = err instanceof ClientApiError ? err.message : "Unexpected error";
        const fields = err instanceof ClientApiError ? Object.values(err.body.fieldErrors ?? {}) : [];
        notify("bad", `${label} failed: ${msg}${fields.length ? ` (${fields.join("; ")})` : ""}`);
        return undefined;
      }
    },
    [refresh, notify],
  );

  const retry = useCallback(() => {
    const fn = lastFailed.current;
    if (fn) void mutate("Retry", fn);
  }, [mutate]);

  const syncUrl = (t: TabKey, v: LabView) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    if (t === "scenarios" && v === "suburbs") url.searchParams.set("view", "suburbs");
    else url.searchParams.delete("view");
    url.searchParams.delete("start");
    window.history.replaceState(null, "", url);
  };

  const goTab = useCallback(
    (t: TabKey | "research", opts?: { view?: LabView }) => {
      const nextTab: TabKey = t === "research" ? "scenarios" : t;
      const nextView: LabView = t === "research" ? "suburbs" : (opts?.view ?? (nextTab === "scenarios" ? labView : "scenarios"));
      setTab(nextTab);
      if (nextTab === "scenarios") setLabViewState(nextView);
      syncUrl(nextTab, nextView);
      window.scrollTo({ top: 0 });
    },
    [labView],
  );

  const setLabView = useCallback((v: LabView) => {
    setLabViewState(v);
    syncUrl("scenarios", v);
  }, []);

  const ctx = useMemo(() => ({ ws, refresh, mutate, save, setSave, changed, tab, goTab, labView, setLabView, notify }), [ws, refresh, mutate, save, changed, tab, goTab, labView, setLabView, notify]);

  return (
    <WsContext.Provider value={ctx}>
      <div className="flex min-h-full flex-1 flex-col">
        <CaseHeader savedAt={savedAt} onRetry={retry} />
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
          {tab === "interview" && <InterviewTab startNotes={startNotes} />}
          {tab === "profile" && <ProfileTab />}
          {tab === "scenarios" && <ScenarioLab />}
          {tab === "report" && <ReportTab />}
          {tab === "activity" && <ActivityTab />}
        </div>
      </div>
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(92vw,420px)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "bad" ? "alert" : "status"}
            className="pointer-events-auto flex items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-[13px] shadow-[var(--shadow-overlay)]"
          >
            <span aria-hidden="true" className={t.tone === "ok" ? "text-ok" : t.tone === "bad" ? "text-bad" : t.tone === "warn" ? "text-warn" : "text-accent"}>
              {t.tone === "ok" ? "✓" : t.tone === "bad" ? "⚠︎" : t.tone === "warn" ? "⚠︎" : "→"}
            </span>
            <span className="flex-1 text-ink-2">{t.text}</span>
            <button type="button" className="text-xs text-ink-secondary hover:text-ink" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="Dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
    </WsContext.Provider>
  );
}

"use client";

import { createContext, useContext } from "react";
import type { Workspace } from "@/lib/services/assessments";

export type SaveState = "saved" | "saving" | "unsaved" | "failed";

export interface WorkspaceCtx {
  ws: Workspace;
  /** Re-fetch the workspace from the server. */
  refresh: () => Promise<void>;
  /**
   * Run a mutation with save-state tracking. 409 revision conflicts reload the workspace and show
   * a message; other failures keep entered information and surface a retryable error.
   * Returns the mutation result, or undefined on failure.
   */
  mutate: <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>;
  save: SaveState;
  setSave: (s: SaveState) => void;
  /** Field paths changed by the last refresh, for highlighting (CON06). */
  changed: Set<string>;
  tab: TabKey;
  /** Switch tab. "research" opens the Scenario Lab's Suburbs view. */
  goTab: (tab: TabKey | "research", opts?: { view?: LabView }) => void;
  labView: LabView;
  setLabView: (v: LabView) => void;
  notify: (tone: "ok" | "bad" | "info" | "warn", text: string) => void;
}

export type TabKey = "interview" | "profile" | "scenarios" | "report" | "activity";
export type LabView = "scenarios" | "suburbs";

export const WsContext = createContext<WorkspaceCtx | null>(null);

export function useWs() {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error("useWs outside workspace");
  return ctx;
}

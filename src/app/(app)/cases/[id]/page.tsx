import Link from "next/link";
import { requireAuth } from "@/lib/auth/session";
import { ApiError } from "@/lib/http";
import { getWorkspace } from "@/lib/services/assessments";
import { Workspace } from "@/components/workspace/Workspace";
import type { TabKey } from "@/components/workspace/context";

const TABS: TabKey[] = ["interview", "profile", "scenarios", "report", "activity"];

export default async function CasePage(props: PageProps<"/cases/[id]">) {
  const auth = await requireAuth();
  const { id } = await props.params;
  const sp = await props.searchParams;
  let ws: Awaited<ReturnType<typeof getWorkspace>>;
  try {
    ws = await getWorkspace(auth, id);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
      return (
        <div className="flex flex-1 items-start justify-center px-4 py-16">
          <div role="alert" className="flex max-w-[680px] flex-col gap-2 rounded-lg border border-line bg-surface p-8">
            <h1 className="text-base font-semibold">{err.status === 403 ? "You don’t have access to this case" : "Case not found"}</h1>
            <p className="text-[13px] leading-relaxed text-ink-secondary">
              {err.status === 403
                ? "Cases are visible to their assigned agent and reviewers. Ask an organisation administrator to assign you."
                : "This case doesn’t exist or isn’t available to your organisation."}
            </p>
            <Link href="/cases" className="mt-1 text-[13px]">
              Back to cases
            </Link>
          </div>
        </div>
      );
    }
    throw err;
  }
  // "research" was the old Research tab; it now lives in the Scenario Lab as the Suburbs view.
  const rawTab = sp.tab === "research" ? "scenarios" : sp.tab;
  const tab = TABS.includes(rawTab as TabKey) ? (rawTab as TabKey) : "interview";
  const view = sp.tab === "research" || sp.view === "suburbs" ? "suburbs" : "scenarios";
  return (
    <Workspace
      initial={JSON.parse(JSON.stringify(ws))}
      initialTab={tab}
      initialView={view}
      startNotes={sp.start === "notes" || (ws.assessment.entryMode === "notes" && ws.turns.length === 0)}
    />
  );
}

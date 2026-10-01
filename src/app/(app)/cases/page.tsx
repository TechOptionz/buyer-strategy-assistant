import { requireAuth } from "@/lib/auth/session";
import { CASE_LIST_STATUSES, listAssessments, reviewerCandidates, type CaseListStatus, type CaseView } from "@/lib/services/assessments";
import { CaseList } from "./CaseList";

export const metadata = { title: "Cases · Buyer Strategy Assistant" };

const PAGE_SIZE = 25;

export default async function CasesPage(props: PageProps<"/cases">) {
  const auth = await requireAuth();
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const status = CASE_LIST_STATUSES.includes(sp.status as CaseListStatus) ? (sp.status as CaseListStatus) : undefined;
  const view: CaseView = sp.view === "mine" || sp.view === "review" ? sp.view : "all";
  const result = await listAssessments(auth, { q: q || undefined, page, pageSize: PAGE_SIZE, status, view });
  const reviewers = (await reviewerCandidates(auth)).filter((r) => r.id !== auth.userId);

  return (
    <CaseList
      items={result.items}
      total={result.total}
      counts={result.counts}
      page={page}
      pageSize={PAGE_SIZE}
      filters={{ q, status: status ?? null, view }}
      canCreate={auth.role !== "reviewer"}
      reviewers={reviewers}
      start={sp.new === "notes" || sp.new === "guided" ? sp.new : null}
    />
  );
}

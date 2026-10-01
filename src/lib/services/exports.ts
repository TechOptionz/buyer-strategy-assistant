import "server-only";
import { and, eq } from "drizzle-orm";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { getDb, schema } from "../db";
import { renderReportPdf } from "../reports/pdf";
import type { ReportSnapshot } from "../reports/snapshot";
import { enqueue, JobError, registerRunner } from "./jobs";
import { loadReport, reportMatchesHash, type ReportSections } from "./reports";

/** Start a PDF export for the exact report version. Idempotent per report row version. */
export async function startExport(ctx: AuthContext, reportId: string, correlationId: string) {
  const { report, db } = await loadReport(ctx, reportId, "view");
  const { job } = await enqueue(db, ctx, "export_pdf", `export:${reportId}:${report.rowVersion}`, { reportId, rowVersion: report.rowVersion }, report.assessmentId);
  await audit(db, ctx, { action: "report.export", objectType: "report", objectId: reportId, assessmentId: report.assessmentId, correlationId, detail: { status: report.status } });
  return job;
}

async function renderFor(report: typeof schema.reports.$inferSelect) {
  const db = await getDb();
  const snapshot = report.snapshot as ReportSnapshot;
  const sections = report.sections as ReportSections;
  // AT17: the export must match the saved snapshot exactly, including after a retry.
  if (!reportMatchesHash(snapshot, sections, report.snapshotHash)) throw new JobError("Report content does not match its saved snapshot", "snapshot_mismatch", false);
  let reviewerName: string | null = null;
  if (report.reviewerId) {
    const [u] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, report.reviewerId));
    reviewerName = u?.name ?? null;
  }
  return renderReportPdf({ snapshot, sections, status: report.status, version: report.version, reviewedAt: report.reviewedAt?.toISOString() ?? null, reviewerName });
}

registerRunner("export_pdf", async (db, job) => {
  const { reportId, rowVersion } = job.payload as { reportId: string; rowVersion: number };
  const [report] = await db.select().from(schema.reports).where(and(eq(schema.reports.id, reportId), eq(schema.reports.organisationId, job.organisationId)));
  if (!report) throw new JobError("Report not found", "not_found", false);
  if (report.rowVersion !== rowVersion) throw new JobError("Report changed after export was requested", "report_changed", false);
  let pdf: Buffer;
  try {
    pdf = await renderFor(report);
  } catch (err) {
    if (err instanceof JobError) throw err;
    throw new JobError("PDF rendering failed", "render_failed", true);
  }
  const [exp] = await db
    .insert(schema.exports)
    .values({ organisationId: job.organisationId, reportId, snapshotHash: report.snapshotHash, byteSize: pdf.length, createdById: job.createdById })
    .returning({ id: schema.exports.id });
  return { exportId: exp.id, snapshotHash: report.snapshotHash, byteSize: pdf.length };
});

/** Authorised download: regenerated from the frozen snapshot and verified against the export record. */
export async function downloadExport(ctx: AuthContext, reportId: string, exportId: string, correlationId: string) {
  const { report, db } = await loadReport(ctx, reportId, "view");
  const [exp] = await db.select().from(schema.exports).where(and(eq(schema.exports.id, exportId), eq(schema.exports.reportId, reportId), eq(schema.exports.organisationId, ctx.organisationId)));
  if (!exp || exp.snapshotHash !== report.snapshotHash) return null;
  const pdf = await renderFor(report);
  await audit(db, ctx, { action: "report.download", objectType: "report", objectId: reportId, assessmentId: report.assessmentId, correlationId });
  return { pdf, filename: `buyer-assessment-${report.version}-${report.status === "reviewed" ? "reviewed" : "draft"}.pdf` };
}

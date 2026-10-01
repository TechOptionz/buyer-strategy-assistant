import { requireAuth } from "@/lib/auth/session";
import { notFound, route } from "@/lib/http";
import { downloadExport } from "@/lib/services/exports";

/** GET /api/reports/{id}/pdf?export={exportId} — authorised download of a completed export. */
export const GET = route(async (req, ctx: RouteContext<"/api/reports/[id]/pdf">, correlationId) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const exportId = new URL(req.url).searchParams.get("export");
  if (!exportId || !/^[0-9a-f-]{36}$/i.test(exportId)) throw notFound("Export");
  const out = await downloadExport(auth, id, exportId, correlationId);
  if (!out) throw notFound("Export");
  return new Response(new Uint8Array(out.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${out.filename}"`,
      "cache-control": "private, no-store",
    },
  });
});

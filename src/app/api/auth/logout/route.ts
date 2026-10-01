import { destroySession } from "@/lib/auth/session";
import { route } from "@/lib/http";

export const POST = route(async () => {
  await destroySession();
  return Response.json({ ok: true });
});

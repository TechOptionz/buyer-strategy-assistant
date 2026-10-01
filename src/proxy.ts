import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect for signed-out page visits. This is a convenience only — every route handler
 * and page verifies the session and permissions itself (hiding a button is not authorisation).
 */
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.has("bsa_session");
  const { pathname } = req.nextUrl;
  if (!hasSession && pathname !== "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};

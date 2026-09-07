/**
 * Reject cross-site requests to state-changing routes.
 *
 * Form-encoded POSTs are CORS "simple requests" — no preflight — so any
 * page the user visits while the control center is up could otherwise
 * drive it. Binding to 127.0.0.1 is a network boundary, not a browser
 * one.
 *
 * Browsers always send Origin on POST; a missing Origin means a
 * non-browser client (curl, the CLI), which is allowed. Origin is
 * compared against the Host header the browser actually addressed rather
 * than request.url, because behind Next those differ (localhost vs
 * 127.0.0.1) and the app's own form would be rejected.
 */
/**
 * Build a redirect target on the host the browser actually addressed.
 *
 * request.url carries Next's internal host, so `new URL(path, request.url)`
 * bounces a visitor on 127.0.0.1 over to localhost — a different origin as
 * far as the browser is concerned, which throws away anything origin-scoped
 * and makes the address bar jump for no reason.
 */
export function sameOriginRedirect(request: Request, path: string): URL {
  const url = new URL(path, request.url);
  const host = request.headers.get("host");
  if (host) url.host = host;
  return url;
}

export function isCrossSite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return true;

  const origin = request.headers.get("origin");
  if (!origin) return false;

  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

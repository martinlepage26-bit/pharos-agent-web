import { NextResponse } from "next/server";
import fs from "node:fs/promises";

const REGISTER_PATH =
  process.env.PHAROS_REGISTER_PATH ??
  "/Users/pharos_ai/Documents/project-control.html";

/** Where the register is allowed to sync. Everything else is blocked. */
const REGISTER_SYNC_ORIGIN =
  process.env.PHAROS_REGISTER_SYNC_ORIGIN ??
  "https://project-control.martinlepage26.workers.dev";

/**
 * This file lives in ~/Documents — a directory that receives downloads,
 * AirDrops and third-party app output — and is served as HTML on the
 * agent's own origin, so its inline script runs with same-origin access
 * to /api/brief, /api/search and /api/speak. It is the one place where
 * untrusted content could cross from data into code execution.
 *
 * The register needs localStorage (so it must stay same-origin) and its
 * own sync endpoint, but it has no business calling the agent. Note that
 * connect-src deliberately omits 'self': fetch/XHR to the agent's API is
 * blocked while the register's own sync still works.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  `style-src 'unsafe-inline' https://fonts.googleapis.com`,
  "font-src https://fonts.gstatic.com",
  "img-src data: blob:",
  `connect-src ${REGISTER_SYNC_ORIGIN}`,
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");

export const dynamic = "force-dynamic";

/**
 * Serves the Project Control shared register live from ~/Documents —
 * wired into the control center. The file is read per request, so edits
 * to the register appear on refresh without a rebuild.
 */
export async function GET() {
  try {
    const html = await fs.readFile(REGISTER_PATH, "utf8");
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": CSP,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(
      `<doctype html><html><body style="background:#040610;color:#8b7aad;font:11px/1.6 monospace;padding:40px;letter-spacing:.1em">
        REGISTER OFFLINE — /Users/pharos_ai/Documents/project-control.html not readable.
      </body></html>`,
      {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  }
}

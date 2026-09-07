import { NextResponse } from "next/server";
import fs from "node:fs/promises";

const REGISTER_PATH =
  process.env.PHAROS_REGISTER_PATH ??
  "/Users/pharos_ai/Documents/project-control.html";

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

import { NextRequest, NextResponse } from "next/server";

/**
 * Wraps a route handler so any uncaught exception is logged and returned as a
 * structured JSON 500 with `{ error: string }`. Without this, thrown errors
 * from upstream SDKs (AI Gateway, fal, Firecrawl) bubble up as bare 500s with
 * empty bodies, and the client can only show "Request failed (500)" — useless
 * for debugging.
 */
export function safeHandler(
  name: string,
  fn: (req: NextRequest) => Promise<NextResponse>,
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    try {
      return await fn(req);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Unknown server error.";
      console.error(`[pico] ${name} route failed:`, e);
      return NextResponse.json(
        { error: `${name} failed: ${message}` },
        { status: 500 },
      );
    }
  };
}

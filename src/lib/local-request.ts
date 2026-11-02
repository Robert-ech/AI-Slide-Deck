import { NextResponse } from "next/server";

/** Write APIs are for a single analyst on loopback, including local CLI imports. */
export function guardLocalMutation(request: Request, bodyType: "json" | "multipart"): NextResponse | null {
  const loopback = ["localhost", "127.0.0.1", "[::1]"];
  let url: URL;
  try { url = new URL(request.url); }
  catch { return NextResponse.json({ error: "Invalid local request URL." }, { status: 403 }); }
  if (!loopback.includes(url.hostname)) {
    return NextResponse.json({ error: "Memo write APIs are available only on loopback." }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (origin !== null) {
    try {
      const supplied = new URL(origin);
      // NextRequest can canonicalize 127.0.0.1 to localhost; both remain loopback.
      if (!loopback.includes(supplied.hostname) || supplied.protocol !== url.protocol || supplied.port !== url.port) {
        throw new Error("Cross-origin request.");
      }
    } catch {
      return NextResponse.json({ error: "Cross-origin writes are blocked." }, { status: 403 });
    }
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Cross-site writes are blocked." }, { status: 403 });
  }
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const expected = bodyType === "json" ? "application/json" : "multipart/form-data";
  if (contentType !== expected) {
    return NextResponse.json({ error: `Use ${expected} for this endpoint.` }, { status: 415 });
  }
  return null;
}

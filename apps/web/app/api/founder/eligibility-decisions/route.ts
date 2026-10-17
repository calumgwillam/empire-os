import { submitFounderEligibilityDecision } from "../../../lib/person-eligibility-provenance";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 8192;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

// Founder intake only: no database configuration, production writer or release
// switch. A well-formed authenticated command still receives an explicit 503
// until independent Person verification and durable issuance are installed.
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("origin") !== new URL(request.url).origin
    || (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) {
    return Response.json({ status: "unauthorized", reason: "forbidden" }, { status: 403, headers });
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return Response.json({ status: "invalid-request", message: "JSON content is required." }, { status: 415, headers });
  }
  const reader = request.body?.getReader();
  if (!reader) {
    return Response.json({ status: "invalid-request", message: "A decision request is required." }, { status: 400, headers });
  }
  let input: unknown;
  try {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return Response.json({ status: "invalid-request", message: "Decision request is too large." }, { status: 413, headers });
      }
      chunks.push(chunk.value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return Response.json({ status: "invalid-request", message: "Invalid decision JSON." }, { status: 400, headers });
  } finally {
    reader.releaseLock();
  }
  const result = await submitFounderEligibilityDecision(request, input);
  const status = result.status === "unauthorized" ? (result.reason === "authentication-required" ? 401 : 403)
    : result.status === "invalid-request" ? 400 : 503;
  return Response.json(result, { status, headers });
}

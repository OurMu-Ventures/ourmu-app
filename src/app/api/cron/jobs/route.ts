import { randomUUID } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { processDueJobs } from "@/lib/jobs";
import { safeSecretEqual } from "@/lib/security/crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const requestId = randomUUID();
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!safeSecretEqual(provided, getServerEnv().CRON_SECRET))
    return Response.json(
      { error: "unauthorized", requestId },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );

  // Queue draining: successive batches of 10 (up to 50 jobs or 40s) so
  // document generation, recipient creation, and email delivery complete in
  // the same hourly run when time permits. Hourly GitHub scheduling remains
  // subject to delays; this improves throughput without promising immediacy.
  let jobs;
  try {
    jobs = await processDueJobs(10, undefined, { drainQueue: true });
  } catch (error) {
    const code =
      error instanceof Error ? error.message.slice(0, 80) : "WORKER_FAILED";
    return Response.json(
      { ok: false, requestId, error: code },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { ok: true, requestId, jobs },
    { headers: { "Cache-Control": "no-store" } },
  );
}

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

  const jobs = await processDueJobs(10);
  return Response.json(
    { ok: true, requestId, jobs },
    { headers: { "Cache-Control": "no-store" } },
  );
}

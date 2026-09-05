import { randomUUID } from "node:crypto";
import { isEnvironmentConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export async function GET() {
  const requestId = randomUUID();
  if (!isEnvironmentConfigured())
    return Response.json(
      {
        ready: false,
        requestId,
        checks: { environment: false, database: false },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("investment_cycles")
      .select("id", { head: true, count: "exact" })
      .limit(1);
    return Response.json(
      {
        ready: !error,
        requestId,
        checks: { environment: true, database: !error },
      },
      { status: error ? 503 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        ready: false,
        requestId,
        checks: { environment: true, database: false },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

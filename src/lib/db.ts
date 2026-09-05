import "server-only";

import { randomUUID } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";

export function toBytea(value: Buffer) {
  return `\\x${value.toString("hex")}`;
}

export function requestId() {
  return randomUUID();
}

export async function audit(input: {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  requestId: string;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("audit_events").insert({
    actor_id: input.actorId ?? null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    request_id: input.requestId,
    metadata: input.metadata ?? {},
  });
  if (error) throw new Error("Audit recording failed");
}

export function publicError(
  error: unknown,
  fallback = "The request could not be completed.",
) {
  if (
    error instanceof Error &&
    [
      "units must",
      "cycle capacity",
      "investor cycle",
      "next of kin",
      "cycle is not",
      "reservation cannot",
      "received amount",
      "typed confirmation",
    ].some((text) => error.message.includes(text))
  ) {
    return error.message;
  }
  return fallback;
}

import { NextResponse } from "next/server";

import { audit, requestId, toBytea } from "@/lib/db";
import { fingerprintRequestValue } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const destination = new URL("/login", url.origin);
  const token = url.searchParams.get("token");
  if (!token || token.length > 200) {
    destination.searchParams.set("contact", "invalid");
    return NextResponse.redirect(destination);
  }
  const admin = createAdminClient();
  const hash = toBytea(fingerprintRequestValue("account-email", token));
  const { data: pending } = await admin
    .from("account_emails")
    .select("id,user_id,verification_expires_at")
    .eq("verification_token_hash", hash)
    .eq("is_primary", false)
    .is("verified_at", null)
    .maybeSingle();
  if (
    pending?.verification_expires_at &&
    new Date(pending.verification_expires_at).getTime() <= Date.now()
  ) {
    await admin
      .from("account_emails")
      .delete()
      .eq("id", pending.id)
      .eq("is_primary", false);
    await audit({
      actorId: pending.user_id,
      action: "account_email.verification_expired",
      entityType: "account_email",
      entityId: pending.id,
      requestId: requestId(),
    });
    destination.searchParams.set("contact", "invalid");
    return NextResponse.redirect(destination);
  }
  const { data, error } = await admin
    .from("account_emails")
    .update({ verified_at: new Date().toISOString(), verification_token_hash: null, verification_expires_at: null })
    .eq("verification_token_hash", hash)
    .eq("is_primary", false)
    .is("verified_at", null)
    .gt("verification_expires_at", new Date().toISOString())
    .select("id,user_id")
    .maybeSingle();
  if (error || !data) {
    destination.searchParams.set("contact", "invalid");
    return NextResponse.redirect(destination);
  }
  await audit({ actorId: data.user_id, action: "account_email.verified", entityType: "account_email", entityId: data.id, requestId: requestId() });
  destination.searchParams.set("contact", "verified");
  return NextResponse.redirect(destination);
}

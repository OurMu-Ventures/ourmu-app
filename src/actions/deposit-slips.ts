"use server";
import { z } from "zod";
import { requireInvestor, requireAdmin } from "@/lib/auth";
import { slipClient, type DepositSlip } from "@/lib/deposit-slips";
import { SLIP_TYPES, validateDepositSlip } from "@/lib/deposit-slip-validation";
async function accessible(id: string) {
  const profile = await requireInvestor();
  if (profile.role === "admin") await requireAdmin();
  const db = slipClient();
  const { data } = await db
    .from("investments")
    .select("id,status,investor_id,record_origin")
    .eq("id", z.uuid().parse(id))
    .single();
  if (
    !data ||
    data.status !== "reserved" ||
    data.record_origin !== "portal" ||
    (data.investor_id !== profile.id && profile.role !== "admin")
  )
    throw new Error("Reservation unavailable.");
  return { db, profile };
}
export async function listDepositSlips(
  investmentId: string,
): Promise<DepositSlip[]> {
  const { db } = await accessible(investmentId);
  const { data, error } = await db
    .from("deposit_slips")
    .select("*")
    .eq("investment_id", investmentId)
    .eq("state", "ready")
    .gt("expires_at", new Date().toISOString())
    .order("created_at");
  if (error) throw new Error("Could not load attachments.");
  return data ?? [];
}
export async function reserveDepositSlip(
  investmentId: string,
  mime: string,
  bytes: number,
) {
  const { db, profile } = await accessible(investmentId);
  if (process.env.DEPOSIT_SLIPS_ENABLED !== "true")
    throw new Error(
      "Uploads are temporarily unavailable. Investment processing continues.",
    );
  z.enum(SLIP_TYPES as [string, ...string[]]).parse(mime);
  z.number().int().min(1).max(2097152).parse(bytes);
  const ceiling = Number(process.env.DEPOSIT_SLIPS_MAX_BYTES ?? 209715200);
  if (!Number.isSafeInteger(ceiling) || ceiling < 1)
    throw new Error("Uploads temporarily unavailable.");
  const { data, error } = await db.rpc("reserve_deposit_slip", {
    p_investor: profile.id,
    p_investment: investmentId,
    p_mime: mime,
    p_bytes: bytes,
    p_ceiling: ceiling,
  });
  if (error) {
    const known = [
      "Three attachments maximum",
      "Uploads temporarily full. Investment processing continues",
      "Previous uploads awaiting cleanup. Please try again later",
      "Reservation unavailable",
    ];
    throw new Error(
      known.find((message) => error.message.includes(message)) ??
        "Uploads are temporarily unavailable. Investment processing continues.",
    );
  }
  return data as DepositSlip;
}
export async function finalizeDepositSlip(investmentId: string, id: string) {
  const { db, profile } = await accessible(investmentId);
  const { data: d } = await db
    .from("deposit_slips")
    .select("*")
    .eq("id", z.uuid().parse(id))
    .eq("investment_id", investmentId)
    .eq("investor_id", profile.id)
    .eq("state", "uploading")
    .single();
  if (!d) throw new Error("Upload unavailable.");
  try {
    const { data: file, error } = await db.storage
      .from("deposit-slips")
      .download(d.path);
    if (error || !file || file.size !== d.bytes)
      throw new Error("Incomplete upload.");
    await validateDepositSlip(new Uint8Array(await file.arrayBuffer()), d.mime);
    const { data: ok, error: finishError } = await db.rpc(
      "finalize_deposit_slip",
      { p_id: id, p_investor: profile.id },
    );
    if (finishError || !ok) throw new Error("Reservation changed.");
  } catch {
    await db.from("deposit_slips").update({ state: "deleting" }).eq("id", id);
    throw new Error(
      "Could not save this file. Use a valid photo or unencrypted PDF up to 2 MiB, and check the reservation is still pending.",
    );
  }
}
export async function removeDepositSlip(investmentId: string, id: string) {
  const { db, profile } = await accessible(investmentId);
  const { error } = await db
    .from("deposit_slips")
    .update({ state: "deleting" })
    .eq("id", z.uuid().parse(id))
    .eq("investment_id", investmentId)
    .eq("investor_id", profile.id);
  if (error) throw new Error("Could not remove attachment.");
}
export async function viewDepositSlip(investmentId: string, id: string) {
  const { db } = await accessible(investmentId);
  const { data: file } = await db
    .from("deposit_slips")
    .select("path")
    .eq("id", z.uuid().parse(id))
    .eq("investment_id", investmentId)
    .eq("state", "ready")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!file) throw new Error("Attachment unavailable.");
  const { data, error } = await db.storage
    .from("deposit-slips")
    .createSignedUrl(file.path, 60);
  if (error || !data) throw new Error("Could not open attachment.");
  return data.signedUrl;
}

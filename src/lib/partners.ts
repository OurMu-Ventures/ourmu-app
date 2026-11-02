import "server-only";

import {
  comparePartners,
  maskPhone,
  type PartnerListing,
  type PartnerRef,
  type PortfolioInvestmentRow,
} from "@/lib/partner-portfolio";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

// Below PostgREST's max_rows (1000). MAX_BATCHES * BATCH_SIZE rows is the
// supported ceiling; beyond it loading fails rather than truncating.
const BATCH_SIZE = 500;
const MAX_BATCHES = 40;

type Batch<T> = PromiseLike<{
  data: T[] | null;
  error: unknown;
  count: number | null;
}>;

// Reads every row of an id-ordered query in batches. The exact count of the
// first batch is the target, so a lower server row limit cannot silently cut
// totals short. Reject changed counts, overlapping pages and premature EOF:
// offset pagination can shift during concurrent writes. The page error
// boundary offers a retry instead of displaying incomplete financial totals.
export async function fetchAllRows<T extends { id: string }>(
  read: (from: number, to: number) => Batch<T>,
) {
  const rows = new Map<string, T>();
  let expected: number | null = null;
  let offset = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data, error, count } = await read(offset, offset + BATCH_SIZE - 1);
    if (error) throw new Error("Unable to load partner records");
    if (count === null || !Number.isSafeInteger(count) || count < 0)
      throw new Error("Unable to verify complete partner records");
    expected ??= count;
    if (count !== expected)
      throw new Error("Partner records changed while loading. Please try again.");
    for (const row of data ?? []) {
      if (rows.has(row.id))
        throw new Error("Partner records changed while loading. Please try again.");
      rows.set(row.id, row);
    }
    offset += data?.length ?? 0;
    if (rows.size > expected || (!data?.length && rows.size < expected))
      throw new Error("Unable to verify complete partner records");
    if (rows.size === expected) return [...rows.values()];
  }
  throw new Error("Partner records exceed the supported size");
}

function names(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function otherNames(name: string, candidates: string[]) {
  const seen = new Set([name.trim().toLocaleLowerCase("en")]);
  return candidates.filter((candidate) => {
    const key = candidate.trim().toLocaleLowerCase("en");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Every portal partner and unclaimed imported identity, name order. Claimed
// identities contribute their imported names to their profile's entry.
export async function loadPartnerListings(
  admin: AdminClient,
): Promise<PartnerListing[]> {
  const [profiles, emails, identities] = await Promise.all([
    fetchAllRows((from, to) =>
      admin
        .from("profiles")
        .select("id,legal_name,email,access_status,kyc_status,is_test", {
          count: "exact",
        })
        .eq("role", "investor")
        .order("id")
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      admin
        .from("account_emails")
        .select("id,user_id,email,verified_at,created_at", { count: "exact" })
        .eq("is_primary", false)
        .order("id")
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      admin
        .from("legacy_partner_identities")
        .select(
          "id,canonical_name,normalized_email,normalized_phone,source_aliases,profile_id,import_batches(status)",
          { count: "exact" },
        )
        .order("id")
        .range(from, to),
    ),
  ]);
  const emailsByUser = new Map<string, typeof emails>();
  for (const entry of [...emails].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  ))
    emailsByUser.set(entry.user_id, [
      ...(emailsByUser.get(entry.user_id) ?? []),
      entry,
    ]);
  const importedNamesByProfile = new Map<string, string[]>();
  for (const identity of identities) {
    if (!identity.profile_id) continue;
    importedNamesByProfile.set(identity.profile_id, [
      ...(importedNamesByProfile.get(identity.profile_id) ?? []),
      identity.canonical_name,
      ...names(identity.source_aliases),
    ]);
  }
  return [
    ...profiles.map((profile) => ({
      ref: { kind: "profile" as const, id: profile.id },
      name: profile.legal_name,
      email: profile.email,
      additionalEmails: (emailsByUser.get(profile.id) ?? []).map((entry) => ({
        email: entry.email,
        verified: Boolean(entry.verified_at),
      })),
      importedNames: otherNames(
        profile.legal_name,
        importedNamesByProfile.get(profile.id) ?? [],
      ),
      accessStatus: profile.access_status,
      kycStatus: profile.kyc_status,
      isTest: profile.is_test,
      phoneHint: null,
      importAccepted: true,
    })),
    ...identities
      .filter((identity) => !identity.profile_id)
      .map((identity) => ({
        ref: { kind: "legacy" as const, id: identity.id },
        name: identity.canonical_name,
        email: identity.normalized_email,
        additionalEmails: [],
        importedNames: otherNames(
          identity.canonical_name,
          names(identity.source_aliases),
        ),
        accessStatus: null,
        kycStatus: null,
        isTest: false,
        phoneHint: maskPhone(identity.normalized_phone),
        importAccepted: identity.import_batches?.status === "accepted",
      })),
  ].sort(comparePartners);
}

export type PortfolioPartner =
  | {
      kind: "profile";
      ref: PartnerRef;
      name: string;
      email: string;
      accessStatus: string;
      kycStatus: string;
      isTest: boolean;
      additionalEmails: { email: string; verified: boolean }[];
      linkedIdentities: { id: string; name: string }[];
    }
  | {
      kind: "legacy";
      ref: PartnerRef;
      name: string;
      email: string | null;
      phoneHint: string | null;
      importAccepted: boolean;
    };

export type PartnerResolution =
  | { status: "found"; partner: PortfolioPartner }
  | { status: "claimed"; profile: PartnerRef }
  | { status: "missing" };

// Resolves a reference to its owner. A claimed imported identity resolves to
// the profile that now owns its records.
export async function resolvePartner(
  admin: AdminClient,
  ref: PartnerRef,
): Promise<PartnerResolution> {
  if (ref.kind === "legacy") {
    const { data, error } = await admin
      .from("legacy_partner_identities")
      .select(
        "id,canonical_name,normalized_email,normalized_phone,profile_id,import_batches(status)",
      )
      .eq("id", ref.id)
      .maybeSingle();
    if (error) throw new Error("Unable to load partner");
    if (!data) return { status: "missing" };
    if (data.profile_id)
      return {
        status: "claimed",
        profile: { kind: "profile", id: data.profile_id },
      };
    return {
      status: "found",
      partner: {
        kind: "legacy",
        ref,
        name: data.canonical_name,
        email: data.normalized_email,
        phoneHint: maskPhone(data.normalized_phone),
        importAccepted: data.import_batches?.status === "accepted",
      },
    };
  }
  const [
    { data: profile, error: profileError },
    { data: identities, error: identitiesError },
    { data: emails, error: emailsError },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id,legal_name,email,access_status,kyc_status,is_test")
      .eq("role", "investor")
      .eq("id", ref.id)
      .maybeSingle(),
    admin
      .from("legacy_partner_identities")
      .select("id,canonical_name")
      .eq("profile_id", ref.id)
      .order("canonical_name"),
    admin
      .from("account_emails")
      .select("email,verified_at")
      .eq("user_id", ref.id)
      .eq("is_primary", false)
      .order("created_at"),
  ]);
  if (profileError || identitiesError || emailsError)
    throw new Error("Unable to load partner");
  if (!profile) return { status: "missing" };
  return {
    status: "found",
    partner: {
      kind: "profile",
      ref,
      name: profile.legal_name,
      email: profile.email,
      accessStatus: profile.access_status,
      kycStatus: profile.kyc_status,
      isTest: profile.is_test,
      additionalEmails: (emails ?? []).map((entry) => ({
        email: entry.email,
        verified: Boolean(entry.verified_at),
      })),
      linkedIdentities: (identities ?? []).map((identity) => ({
        id: identity.id,
        name: identity.canonical_name,
      })),
    },
  };
}

// PostgREST filter for every record a partner owns: profile-owned rows plus
// rows still keyed to a linked imported identity. One OR query returns each
// record once. IDs come from resolved database rows, never from raw input.
export function partnerInvestmentFilter(partner: PortfolioPartner) {
  if (partner.kind === "legacy")
    return `legacy_partner_id.eq.${partner.ref.id}`;
  const linked = partner.linkedIdentities.map((identity) => identity.id);
  return linked.length
    ? `investor_id.eq.${partner.ref.id},legacy_partner_id.in.(${linked.join(",")})`
    : `investor_id.eq.${partner.ref.id}`;
}

// Every record of one partner, independent of any table page, so totals
// always cover the whole portfolio.
export async function loadPortfolioInvestments(
  admin: AdminClient,
  partner: PortfolioPartner,
): Promise<PortfolioInvestmentRow[]> {
  const filter = partnerInvestmentFilter(partner);
  return fetchAllRows((from, to) =>
    admin
      .from("investments")
      .select(
        "id,cycle_id,status,record_origin,alias,principal_ugx,projected_return_ugx,projected_value_ugx,maturity_date,requested_at,payout_basis,reported_return_ugx,reported_payout_ugx,is_test,administratively_archived_at,offline_settlement_id,investment_cycles(name,opens_at,actual_return_bps,legacy_settlement),import_batches(status),maturity_instructions!maturity_instructions_investment_id_fkey(status,choice,needs_resolution,actual_payout_ugx,actual_reinvest_ugx,fulfilled_at),investment_receipts!investment_receipts_investment_id_fkey(id,receipt_number,pdf_status),offline_reinvestment_authorizations!offline_reinvestment_authorizations_investment_id_fkey(status,amount_ugx)",
        { count: "exact" },
      )
      .or(filter)
      .order("id")
      .range(from, to),
  );
}

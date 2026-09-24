import { ActivationForm } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { dateTime, ugx, units } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { getReceiptDownloadUrl } from "@/actions/receipts";
export default async function AdminInvestmentsPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin
    .from("investments")
    .select(
      "*,profiles(legal_name,email),investment_cycles(name),legacy_partner_identities(canonical_name,normalized_email),investment_receipts(id,receipt_number,pdf_status)",
    )
    .order("requested_at", { ascending: false })
    .limit(100);
  return (
    <>
      <p className="eyebrow">External bank verification</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>
        Investment activation
      </h1>
      <p className="notice">
        Compare the bank statement independently. Activation requires exact
        amount, unique reference, received date, typed confirmation, and your
        current AAL2 session.
      </p>
      {(data ?? []).map((item) => (
        <article
          className="card"
          style={{ marginBottom: "1rem" }}
          key={item.id}
        >
          <div className="page-head">
            <div>
              <h2>
                {(Array.isArray(item.profiles)
                  ? item.profiles[0]?.legal_name
                  : item.profiles?.legal_name) ??
                  (Array.isArray(item.legacy_partner_identities)
                    ? item.legacy_partner_identities[0]?.canonical_name
                    : item.legacy_partner_identities?.canonical_name) ??
                  "Unclaimed partner"}
              </h2>
              <p>
                {units(item.units ?? 0)} units · {ugx(item.principal_ugx)} ·
                requested {dateTime(item.requested_at)}
              </p>
            </div>
            <span className="badge">{item.status}</span>
          </div>
          {item.status === "reserved" && item.record_origin === "portal" && (
            <ActivationForm
              investmentId={item.id}
              expectedAmount={Number(item.principal_ugx)}
            />
          )}
          <ReceiptAdminLine
            receipts={
              (item as unknown as { investment_receipts?: { id: string; receipt_number: string; pdf_status: string } | { id: string; receipt_number: string; pdf_status: string }[] | null }).investment_receipts ?? null
            }
          />
        </article>
      ))}
    </>
  );
}

async function ReceiptAdminLine({
  receipts,
}: {
  receipts:
    | { id: string; receipt_number: string; pdf_status: string }
    | { id: string; receipt_number: string; pdf_status: string }[]
    | null;
}) {
  const receipt = Array.isArray(receipts) ? receipts[0] : receipts;
  if (!receipt) return null;
  if (receipt.pdf_status !== "ready") {
    return (
      <p className="muted">
        Receipt {receipt.receipt_number}: {receipt.pdf_status}
      </p>
    );
  }
  const url = await getReceiptDownloadUrl(receipt.id);
  if (!url) {
    return (
      <p className="muted">Receipt {receipt.receipt_number}: ready</p>
    );
  }
  return (
    <p>
      <a className="button" href={url} rel="noreferrer">
        Download receipt {receipt.receipt_number}
      </a>
    </p>
  );
}

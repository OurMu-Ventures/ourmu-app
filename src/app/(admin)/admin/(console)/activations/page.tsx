import Link from "next/link";

import { ActivationForm } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { date, dateTime, ugx } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE_SIZE = 25;

export default async function AdminActivationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  await requireAdmin();
  const admin = createAdminClient();
  const params = await searchParams;
  const rawPage = typeof params.page === "string" ? params.page : "";
  const parsedPage = Number(rawPage);
  const page =
    /^\d+$/.test(rawPage) &&
    Number.isSafeInteger(parsedPage) &&
    parsedPage > 0 &&
    parsedPage <= 1_000_000
      ? parsedPage
      : 1;
  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await admin
    .from("investments")
    .select(
      "id,status,principal_ugx,requested_at,reservation_expires_at,maturity_date,is_test,policy_version,profiles(legal_name,email),investment_cycles(name)",
      { count: "exact" },
    )
    .in("status", ["reserved", "expired"])
    .or("status.eq.reserved,policy_version.eq.auto_cycle_v1")
    .eq("record_origin", "portal")
    .eq("payout_basis", "projected")
    .not("reservation_expires_at", "is", null)
    .order("reservation_expires_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error("Unable to load investments awaiting activation");
  const items = data ?? [];
  const total = count ?? 0;
  return (
    <>
      <p className="eyebrow">Pending investment reservations</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Activations</h1>
      <p className="notice">
        Compare bank statements independently before activating a reservation.
        Confirm the exact amount, a unique bank reference, the verified payment
        date and time (Africa/Kampala), and the received date, then type
        ACTIVATE. Timely payments can be verified after expiry; payments after
        the deadline are held for staff resolution, never revived from cancelled
        reservations, and never moved to another cycle automatically.
      </p>
      <p className="muted" aria-live="polite">
        {items.length
          ? `Showing ${from + 1}–${from + items.length} of ${total} reservations awaiting activation.`
          : page > 1
            ? "No pending reservations on this page."
            : "No investments awaiting activation."}
      </p>
      {items.map((item) => (
        <article
          className="card"
          style={{ marginBottom: "1rem" }}
          key={item.id}
        >
          <div className="page-head">
            <div>
              <h2>{item.profiles?.legal_name ?? "Partner"}</h2>
              <p className="muted">{item.profiles?.email}</p>
              <p>
                {item.investment_cycles?.name ?? "Unknown cycle"} ·{" "}
                {ugx(item.principal_ugx)}
              </p>
              <p className="muted">
                Requested {dateTime(item.requested_at)} · Matures{" "}
                {date(item.maturity_date)}
              </p>
              <p>
                Payment deadline{" "}
                <strong>
                  {item.reservation_expires_at
                    ? dateTime(item.reservation_expires_at)
                    : "Not set"}
                </strong>{" "}
                (Africa/Kampala) · {item.status}
                {item.policy_version ? ` · ${item.policy_version}` : ""}
              </p>
            </div>
            <span className="badge">
              {item.is_test
                ? "Test reservation"
                : item.status === "expired"
                  ? "Expired — verify timely payment only"
                  : "Awaiting activation"}
            </span>
          </div>
          <ActivationForm
            investmentId={item.id}
            expectedAmount={Number(item.principal_ugx)}
          />
        </article>
      ))}
      {(page > 1 || page * PAGE_SIZE < total) && (
        <nav
          className="admin-investment-pagination"
          aria-label="Activation pages"
        >
          {page > 1 && (
            <Link
              className="button-secondary"
              href={`/admin/activations?page=${page - 1}`}
            >
              Previous
            </Link>
          )}
          <span className="muted">
            Page {page}
            {total > 0 ? ` of ${Math.ceil(total / PAGE_SIZE)}` : ""}
          </span>
          {page * PAGE_SIZE < total && (
            <Link
              className="button-secondary"
              href={`/admin/activations?page=${page + 1}`}
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </>
  );
}

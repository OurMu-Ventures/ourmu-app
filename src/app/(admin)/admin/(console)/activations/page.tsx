import Link from "next/link";
import { z } from "zod";

import { ActivationForm, ExpireReservationForm } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { date, dateTime, ugx } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE_SIZE = 25;

export default async function AdminActivationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string | string[];
    activated?: string | string[];
  }>;
}) {
  await requireAdmin();
  const admin = createAdminClient();
  const params = await searchParams;
  const activatedId = z.uuid().safeParse(params.activated);
  const activationResult = activatedId.success
    ? await admin
        .from("investments")
        .select(
          "id,principal_ugx,activated_at,profiles(legal_name),investment_cycles(name)",
        )
        .eq("id", activatedId.data)
        .eq("status", "active")
        .eq("record_origin", "portal")
        .maybeSingle()
    : null;
  const activeInvestment = activationResult?.error
    ? null
    : activationResult?.data;
  const activatedAt = activeInvestment?.activated_at
    ? Date.parse(activeInvestment.activated_at)
    : NaN;
  // eslint-disable-next-line react-hooks/purity -- time-bound server-rendered confirmation
  const activationAge = Date.now() - activatedAt;
  const activated =
    Number.isFinite(activationAge) &&
    activationAge >= 0 &&
    activationAge <= 5 * 60_000
      ? activeInvestment
      : null;
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
      "id,status,principal_ugx,requested_at,maturity_date,is_test,policy_version,profiles(legal_name,email),investment_cycles(name)",
      { count: "exact" },
    )
    .eq("status", "reserved")
    .eq("record_origin", "portal")
    .eq("payout_basis", "projected")
    .order("requested_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error("Unable to load investments awaiting activation");
  const items = data ?? [];
  const total = count ?? 0;
  return (
    <>
      <p className="eyebrow">Pending investment reservations</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Activations</h1>
      {activated && (
        <div
          id="activation-success"
          className="success"
          role="status"
          tabIndex={-1}
        >
          <strong>Investment activated successfully.</strong>
          <p>
            {activated.profiles?.legal_name ?? "Partner"} ·{" "}
            {ugx(activated.principal_ugx)} ·{" "}
            {activated.investment_cycles?.name ?? "Investment cycle"}
          </p>
          <p>
            The investment is now active and has been removed from the pending
            queue. Receipt and agreement downloads will appear under Investments
            when ready.
          </p>
          <Link className="button-secondary" href="/admin/investments">
            View investments
          </Link>{" "}
          <Link href="/admin/activations">Dismiss</Link>
        </div>
      )}
      {activatedId.success && !activeInvestment && (
        <p className="notice" role="alert">
          Activation status could not be confirmed. Check Investments before
          trying again.
        </p>
      )}
      <p className="notice">
        Compare bank statements independently before activating a reservation.
        Confirm the exact amount, a unique bank reference, and the payment
        received date using Uganda’s calendar date, then type ACTIVATE.
        Reservations stay pending until activated, manually expired, or
        cancelled. Payments must match the reserved cycle. Check for received
        funds before expiring a reservation.
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
              <p>No automatic expiry · {item.status}</p>
            </div>
            <span className="badge">
              {item.is_test ? "Test reservation" : "Awaiting activation"}
            </span>
          </div>
          <ActivationForm
            investmentId={item.id}
            expectedAmount={Number(item.principal_ugx)}
          />
          <ExpireReservationForm investmentId={item.id} />
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

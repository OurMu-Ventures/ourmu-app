"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createInvitation,
  reissueInvitation,
  revokeInvitation,
} from "@/actions/applications";
import { ApplicationDecisionForm } from "@/components/ApplicationDecisionForm";
import { StateMessage } from "@/components/StateMessage";
import { Button } from "@/components/ui/button";
import { PendingButton } from "@/components/ui/pending-button";
import { LinkStatus } from "@/components/ui/link-status";
import {
  APPLICATION_PAGE_SIZE,
  applicationDate as date,
  applicationDateTime as dateTime,
  applicationsUrl,
  invitationStatus,
  type ApplicationCard,
  type ApplicationView,
  type InvitationCard,
} from "@/lib/application-views";
import { initialActionState, type ActionState } from "@/lib/validation";

function InviteApplicant({ open }: { open: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [state, action] = useActionState(
    async (previous: ActionState, data: FormData) => {
      const result = await createInvitation(previous, data);
      if (result.ok) setEmail("");
      return result;
    },
    initialActionState,
  );
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  return (
    <form className="form card application-invite" action={action}>
      <h2>Invite an applicant</h2>
      <p className="muted">
        We’ll email a private application link that expires after seven days.
      </p>
      <label>
        Email address
        <input
          ref={input}
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <PendingButton pendingLabel="Sending invitation…">
        Send invitation
      </PendingButton>
      <StateMessage state={state} />
    </form>
  );
}

function InvitationActions({
  item,
  onResult,
}: {
  item: InvitationCard;
  onResult: (state: ActionState) => void;
}) {
  const [state, action] = useActionState(
    async (_: ActionState, data: FormData) => {
      const result =
        data.get("decision") === "revoke"
          ? await revokeInvitation(data)
          : await reissueInvitation(data);
      if (result.ok)
        onResult({
          ...result,
          message: `${item.invited_email}: ${result.message}`,
        });
      return result;
    },
    initialActionState,
  );
  return (
    <form action={action} className="form">
      <input type="hidden" name="invitationId" value={item.id} />
      <div className="application-actions">
        <PendingButton
          variant="secondary"
          name="decision"
          value="reissue"
          pendingLabel="Working…"
        >
          Reissue
        </PendingButton>
        {!item.revoked_at && (
          <PendingButton
            variant="secondary"
            name="decision"
            value="revoke"
            pendingLabel="Working…"
          >
            Revoke
          </PendingButton>
        )}
      </div>
      {!state.ok && <StateMessage state={state} />}
    </form>
  );
}

function ApplicationDetails({ item }: { item: ApplicationCard }) {
  return (
    <dl className="application-details">
      <div>
        <dt>Phone</dt>
        <dd>{item.phone}</dd>
      </div>
      <div>
        <dt>Date of birth</dt>
        <dd>{date(item.date_of_birth)}</dd>
      </div>
      <div>
        <dt>Address</dt>
        <dd>
          {[item.address, item.district, item.country]
            .filter(Boolean)
            .join(", ")}
        </dd>
      </div>
    </dl>
  );
}

const views = [
  ["review", "Needs review"],
  ["invitations", "Invitations"],
  ["history", "History"],
] as const;
const descriptions = {
  review: "Review submitted applications, starting with the oldest.",
  invitations: "Manage application links and follow up on unused invitations.",
  history: "Past application decisions and abandoned applications.",
};
const empty = {
  review: "No applications need review. New submissions will appear here.",
  invitations: "No invitations yet. Invite an applicant to get started.",
  history: "No application history yet. Completed decisions will appear here.",
};

export function ApplicationsWorkspace({
  tab,
  page,
  count,
  pendingCount,
  applications,
  invitations,
  loadError,
  now,
}: {
  tab: ApplicationView;
  page: number;
  count: number;
  pendingCount: number | null;
  applications: ApplicationCard[];
  invitations: InvitationCard[];
  loadError: boolean;
  now: number;
}) {
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  // This workspace stays mounted through action revalidation, even when the
  // reviewed card disappears. Never store sensitive one-time links in the URL.
  const [feedback, setFeedback] = useState(initialActionState);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const inviteId = useId();
  useEffect(() => {
    if (feedback.message) feedbackRef.current?.focus();
  }, [feedback]);
  const totalPages = Math.max(1, Math.ceil(count / APPLICATION_PAGE_SIZE));
  return (
    <div className="applications-workspace">
      <div className="page-head applications-heading">
        <div>
          <p className="eyebrow">Partner enrollment</p>
          <h1>Applications</h1>
          <p className="muted">
            Invite applicants and manage their application journey.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          aria-expanded={inviteOpen}
          aria-controls={inviteId}
          onClick={() => setInviteOpen((value) => !value)}
        >
          {inviteOpen ? "Close invitation form" : "Invite applicant"}
        </Button>
      </div>
      <div id={inviteId} hidden={!inviteOpen}>
        <InviteApplicant open={inviteOpen} />
      </div>
      <div ref={feedbackRef} tabIndex={-1}>
        <StateMessage state={feedback} />
      </div>
      <nav className="application-views" aria-label="Application views">
        {views.map(([view, label]) => (
          <Link
            key={view}
            href={applicationsUrl(view)}
            aria-current={tab === view ? "page" : undefined}
            aria-label={
              view === "review" && pendingCount !== null
                ? `Needs review (${pendingCount} pending)`
                : label
            }
          >
            {label}
            {view === "review" && pendingCount !== null && (
              <span className="badge"> {pendingCount}</span>
            )}
            <LinkStatus label={`Opening ${label.toLowerCase()}`} />
          </Link>
        ))}
      </nav>
      {pendingCount === null && (
        <p role="alert" className="error">
          The pending application count is unavailable.
        </p>
      )}
      <p className="muted">
        {descriptions[tab]} Times shown in Uganda time (EAT).
      </p>
      {loadError ? (
        <div className="card" role="alert">
          <p>We couldn’t load this view. Please try again.</p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.refresh()}
          >
            Try again
          </Button>
        </div>
      ) : (
        <>
          {count === 0 && <p className="card">{empty[tab]}</p>}
          {tab === "invitations"
            ? invitations.map((item) => (
                <article className="card application-card" key={item.id}>
                  <div className="page-head">
                    <h2>{item.invited_email}</h2>
                    <span className="badge">{invitationStatus(item, now)}</span>
                  </div>
                  <p className="muted">
                    Sent {dateTime(item.created_at)}
                    <br />
                    Expires {dateTime(item.expires_at)}
                  </p>
                  {!item.used_at && (
                    <InvitationActions item={item} onResult={setFeedback} />
                  )}
                </article>
              ))
            : applications.map((item) => (
                <article className="card application-card" key={item.id}>
                  <div className="page-head">
                    <div>
                      <h2>{item.legal_name}</h2>
                      <p>{item.email}</p>
                    </div>
                    <span className="badge">{item.status}</span>
                  </div>
                  <p className="muted">
                    Submitted {dateTime(item.created_at)}
                    {tab === "history" && item.reviewed_at && (
                      <>
                        <br />
                        Decision recorded {dateTime(item.reviewed_at)}
                      </>
                    )}
                  </p>
                  <details>
                    <summary>
                      {tab === "review"
                        ? "Review application"
                        : "View application details"}
                      <span className="sr-only"> for {item.legal_name}</span>
                    </summary>
                    <ApplicationDetails item={item} />
                    {tab === "review" && item.status === "submitted" && (
                      <ApplicationDecisionForm
                        applicationId={item.id}
                        onSuccess={(result) =>
                          setFeedback({
                            ...result,
                            message: `${item.legal_name}: ${result.message}`,
                          })
                        }
                      />
                    )}
                  </details>
                </article>
              ))}
          {count > 0 && (
            <nav
              className="application-pagination"
              aria-label="Application pagination"
            >
              {page > 1 && (
                <Link href={applicationsUrl(tab, page - 1)}>
                  Previous
                  <LinkStatus label="Loading previous page" />
                </Link>
              )}
              <span>
                Page {page} of {totalPages} · {count}{" "}
                {count === 1 ? "record" : "records"}
              </span>
              {page < totalPages && (
                <Link href={applicationsUrl(tab, page + 1)}>
                  Next
                  <LinkStatus label="Loading next page" />
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}

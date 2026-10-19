"use client";

import { useActionState, useId, useState } from "react";

import { approveApplication, rejectApplication } from "@/actions/applications";
import { StateMessage } from "@/components/StateMessage";
import { PendingButton } from "@/components/ui/pending-button";
import { initialActionState, type ActionState } from "@/lib/validation";

async function reviewApplication(state: ActionState, formData: FormData) {
  switch (formData.get("decision")) {
    case "approve":
      return approveApplication(state, formData);
    case "reject":
      return rejectApplication(state, formData);
    default:
      return { ok: false, message: "Choose Approve or Reject to continue." };
  }
}

export function ApplicationDecisionForm({
  applicationId,
}: {
  applicationId: string;
}) {
  const [state, action] = useActionState(reviewApplication, initialActionState);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const helpId = useId();

  return (
    <form className="form" action={action}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <p id={helpId} className="muted">
        Record the offline verification reference, then approve or reject this
        application.
      </p>
      <label>
        Offline verification reference (required)
        <input
          name="verificationReference"
          required
          aria-describedby={helpId}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      </label>
      <label>
        Non-sensitive notes (optional)
        <textarea
          name="notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <StateMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <PendingButton name="decision" value="approve" pendingLabel="Working…">
          Approve and send magic link
        </PendingButton>
        <PendingButton
          name="decision"
          value="reject"
          variant="secondary"
          pendingLabel="Working…"
        >
          Reject and erase NIN
        </PendingButton>
      </div>
    </form>
  );
}

"use client";

import { useActionState } from "react";

import { resolveMaturityCcReview } from "@/actions/admin";
import { StateMessage } from "@/components/StateMessage";
import { SubmitButton } from "@/components/SubmitButton";
import { initialActionState } from "@/lib/validation";

export function ResolveMaturityCcReviewForm({ jobId }: { jobId: string }) {
  const [state, action] = useActionState(
    resolveMaturityCcReview,
    initialActionState,
  );

  return (
    <form action={action}>
      <input type="hidden" name="jobId" value={jobId} />
      <SubmitButton pendingLabel="Saving…">Mark CC reviewed</SubmitButton>
      <StateMessage state={state} />
    </form>
  );
}

"use client";

import { useActionState } from "react";

import { PendingButton } from "@/components/ui/pending-button";
import { StateMessage } from "@/components/StateMessage";
import { initialActionState, type ActionState } from "@/lib/validation";

export function CancelInvestmentButton({
  action,
  investmentId,
  variant = "ghost",
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  investmentId: string;
  variant?: "ghost" | "danger";
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction}>
      <input type="hidden" name="investmentId" value={investmentId} />
      <PendingButton
        variant={variant}
        pendingLabel="Cancelling…"
        aria-label="Cancel reserved investment"
      >
        Cancel reservation
      </PendingButton>
      <StateMessage state={state} />
    </form>
  );
}

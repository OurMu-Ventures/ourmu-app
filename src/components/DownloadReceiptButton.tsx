"use client";

import { useActionState } from "react";
import { downloadInvestmentReceipt } from "@/actions/receipts";
import { StateMessage } from "@/components/StateMessage";
import { PendingButton } from "@/components/ui/pending-button";
import { initialActionState } from "@/lib/validation";

export function DownloadReceiptButton({
  investmentId,
}: {
  investmentId: string;
}) {
  const [state, action] = useActionState(
    downloadInvestmentReceipt,
    initialActionState,
  );
  return (
    <form action={action}>
      <input type="hidden" name="investmentId" value={investmentId} />
      <PendingButton variant="secondary" pendingLabel="Preparing receipt…">
        Download receipt
      </PendingButton>
      <StateMessage state={state} />
    </form>
  );
}

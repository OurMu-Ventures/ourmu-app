"use client";

import { useActionState } from "react";
import { downloadAdminReceipt } from "@/actions/receipts";
import { StateMessage } from "@/components/StateMessage";
import { PendingButton } from "@/components/ui/pending-button";
import { initialActionState } from "@/lib/validation";

export function AdminReceiptDownload({
  receiptId,
  receiptNumber,
}: {
  receiptId: string;
  receiptNumber: string;
}) {
  const [state, action] = useActionState(
    downloadAdminReceipt,
    initialActionState,
  );
  return (
    <form action={action}>
      <input type="hidden" name="receiptId" value={receiptId} />
      <PendingButton variant="secondary" pendingLabel="Preparing…">
        Receipt {receiptNumber}
      </PendingButton>
      <StateMessage state={state} />
    </form>
  );
}

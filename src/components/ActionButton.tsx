"use client";
import { PendingButton } from "@/components/ui/pending-button";
export function ActionButton({
  children,
  danger = false,
}: {
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <PendingButton
      variant={danger ? "danger" : "default"}
      pendingLabel="Working…"
    >
      {children}
    </PendingButton>
  );
}

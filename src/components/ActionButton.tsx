"use client";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
export function ActionButton({
  children,
  danger = false,
}: {
  children: React.ReactNode;
  danger?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button variant={danger ? "danger" : "default"} disabled={pending} type="submit">
      {pending ? "Working…" : children}
    </Button>
  );
}

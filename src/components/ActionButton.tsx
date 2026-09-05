"use client";
import { useFormStatus } from "react-dom";
export function ActionButton({
  children,
  danger = false,
}: {
  children: React.ReactNode;
  danger?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={danger ? "button-danger" : "button"}
      disabled={pending}
      type="submit"
    >
      {pending ? "Working…" : children}
    </button>
  );
}

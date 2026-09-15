"use client";

import { useFormStatus } from "react-dom";

type SubmitButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingLabel: string;
};

// Plain <button> that acknowledges the tap instantly while preserving the
// caller's native styling (table actions, nav sign-out, legacy .button).
// While the enclosing form's server action runs it disables itself,
// announces progress to screen readers, and swaps its label.
export function SubmitButton({
  pendingLabel,
  children,
  disabled,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      {...props}
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
    >
      {pending ? pendingLabel : children}
      <span className="sr-only" aria-live="polite">
        {pending ? pendingLabel : ""}
      </span>
    </button>
  );
}

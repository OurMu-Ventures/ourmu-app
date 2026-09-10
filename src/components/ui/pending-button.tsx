"use client";

import type { ComponentProps } from "react";
import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PendingButtonProps = ComponentProps<typeof Button> & {
  pendingLabel: string;
  iconOnly?: boolean;
};

// Submit button that acknowledges the tap instantly: while the enclosing
// form's server action runs it keeps its size (content rendered invisibly
// underneath, spinner + label overlaid), disables itself, and announces
// progress to screen readers.
export function PendingButton({
  pendingLabel,
  iconOnly = false,
  children,
  className,
  disabled,
  ...props
}: PendingButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button
      {...props}
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      aria-label={pending && iconOnly ? pendingLabel : props["aria-label"]}
      className={cn("relative", className)}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center gap-2",
          pending && "invisible",
        )}
      >
        {children}
      </span>
      {pending ? (
        <span
          className="absolute inset-0 inline-flex items-center justify-center gap-2"
          aria-hidden="true"
        >
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
          {!iconOnly ? pendingLabel : null}
        </span>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {pending ? pendingLabel : ""}
      </span>
    </Button>
  );
}

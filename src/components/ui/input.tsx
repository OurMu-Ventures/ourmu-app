import * as React from "react";

import { cn } from "@/lib/utils";

// 16px base font keeps iOS Safari from auto-zooming focused fields.
export function Input({
  className,
  type,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "min-h-12 w-full rounded-[0.65rem] border border-[#aeb8b3] bg-white px-3 py-2 text-base text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus-visible:outline-[3px] focus-visible:outline-[rgba(215,167,71,0.45)] focus-visible:outline-offset-2 disabled:opacity-55",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-[120px] w-full rounded-[0.65rem] border border-[#aeb8b3] bg-white px-3 py-2 text-base text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus-visible:outline-[3px] focus-visible:outline-[rgba(215,167,71,0.45)] focus-visible:outline-offset-2 disabled:opacity-55",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "min-h-12 w-full rounded-[0.65rem] border border-[#aeb8b3] bg-white px-3 py-2 text-base text-[var(--ink)] outline-none focus-visible:outline-[3px] focus-visible:outline-[rgba(215,167,71,0.45)] focus-visible:outline-offset-2 disabled:opacity-55",
        className,
      )}
      {...props}
    />
  );
}

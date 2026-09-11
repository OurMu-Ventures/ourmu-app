import * as React from "react";

import { cn } from "@/lib/utils";

export function Badge({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-[#e8eee9] px-2.5 py-1 text-xs font-bold text-[var(--ink)]",
        className,
      )}
      {...props}
    />
  );
}

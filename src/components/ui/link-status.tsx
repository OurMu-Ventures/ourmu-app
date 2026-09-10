"use client";

import { LoaderCircle } from "lucide-react";
import { useLinkStatus } from "next/link";

// Renders inside a Next.js Link and shows a spinner from the moment the
// link is tapped until the destination page finishes loading. The spinner
// slot is always in the layout so nothing shifts when it appears, and the
// status text is screen-reader-only: visible copy never changes.
export function LinkStatus({ label = "Loading page" }: { label?: string }) {
  const { pending } = useLinkStatus();

  return (
    <span className="relative size-4 shrink-0" aria-live="polite">
      <LoaderCircle
        className={`absolute inset-0 size-4 animate-spin motion-reduce:animate-none ${pending ? "opacity-100" : "opacity-0"}`}
        aria-hidden="true"
      />
      <span className="sr-only">{pending ? label : ""}</span>
    </span>
  );
}

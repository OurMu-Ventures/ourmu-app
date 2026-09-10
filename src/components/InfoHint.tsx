"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";

// Info-hint tooltip (legacy product copy lives with the call sites).
// Tap or hover to reveal; Escape or tapping elsewhere dismisses.
export function InfoHint({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open ]);

  return (
    <span ref={wrapRef} className="info-hint">
      <button
        type="button"
        className="info-hint-button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={tipId}
        onClick={() => setOpen((value) => !value)}
      >
        <Info aria-hidden="true" />
      </button>
      {open && (
        <span role="tooltip" id={tipId} className="info-tip">
          {text}
        </span>
      )}
    </span>
  );
}

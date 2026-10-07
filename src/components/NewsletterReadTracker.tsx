"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { recordNewsletterVisit } from "@/actions/newsletters";

/** Mounting, not Server Component rendering/prefetching, starts a visit. */
export function NewsletterReadTracker({ slug, children }: { slug: string; children: ReactNode }) {
  const endRef = useRef<HTMLDivElement>(null);
  const visitRef = useRef<{ slug: string; id: string } | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || typeof crypto.randomUUID !== "function") return;
    if (!visitRef.current || visitRef.current.slug !== slug) {
      visitRef.current = { slug, id: crypto.randomUUID() };
    }
    const visitId = visitRef.current.id;
    let cancelled = false;
    let opened = false;
    let opening = false;
    let openAttempts = 0;
    let reachedEnd = false;
    let endInView = false;
    let completed = false;
    let completing = false;
    let completionAttempts = 0;
    let visibleSeconds = 0;

    const open = async () => {
      if (cancelled || opening || opened || openAttempts >= 3 || document.visibilityState !== "visible") return;
      opening = true;
      openAttempts += 1;
      try {
        const accepted = await recordNewsletterVisit({ slug, visitId, event: "opened" });
        if (!cancelled) opened = accepted;
      } catch { /* Analytics must never interrupt reading. */ }
      finally { opening = false; }
    };
    const complete = async () => {
      if (cancelled || completed || completing || completionAttempts >= 3 || !opened || !reachedEnd || visibleSeconds < 30) return;
      completing = true;
      completionAttempts += 1;
      try {
        const accepted = await recordNewsletterVisit({ slug, visitId, event: "reached_end" });
        if (!cancelled) completed = accepted;
      } catch { /* Retry on the next visible tick. */ }
      finally { completing = false; }
    };
    const observer = new IntersectionObserver((entries) => {
      endInView = entries.some((entry) => entry.isIntersecting);
      if (document.visibilityState === "visible" && endInView) {
        reachedEnd = true;
        void complete();
      }
    });
    if (endRef.current) observer.observe(endRef.current);
    const tick = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (!opened) { void open(); return; }
      if (endInView) reachedEnd = true;
      visibleSeconds += 1;
      void complete();
    }, 1000);
    void open();
    document.addEventListener("visibilitychange", open);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
      observer.disconnect();
      document.removeEventListener("visibilitychange", open);
    };
  }, [slug]);

  return <div>{children}<div ref={endRef} aria-hidden="true" style={{ height: 1 }} /></div>;
}

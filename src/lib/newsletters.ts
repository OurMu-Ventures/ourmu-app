import "server-only";

import type { ComponentType } from "react";

import { October2026Newsletter } from "@/components/newsletter/October2026Newsletter";

import { August2026Newsletter } from "@/components/newsletter/August2026Newsletter";

export type NewsletterStatus = "published" | "draft";

export type NewsletterEntry = {
  slug: string;
  title: string;
  /** Display label, e.g. "August 2026". Month only; exact release day unknown. */
  issueMonth: string;
  /** ISO date used for newest-first ordering. */
  issueDate: string;
  summary: string;
  status: NewsletterStatus;
  Content: ComponentType;
};

const registry: NewsletterEntry[] = [
  {
    slug: "october-2026",
    title: "Partner Update — October 2026",
    issueMonth: "October 2026",
    issueDate: "2026-10-01",
    summary:
      "Nsena Ku Jengo farm performance, feed efficiency and net improvements, featured Partner Jonathan Amwesiga, Buyege broodstock arrival, and the Partner Portal Q&A webinar on 31 October.",
    status: "published",
    Content: October2026Newsletter,
  },
  {
    slug: "august-2026",
    title: "Partner Update — August 2026",
    issueMonth: "August 2026",
    issueDate: "2026-08-01",
    summary:
      "Bwooji Elijah on 2026 goals and hatchery progress, Jan–Jun investment figures, why fingerling supply matters, featured partners the Tushabes, welcoming Aaron, and the Buyege hatchery opening.",
    status: "published",
    Content: August2026Newsletter,
  },
];

function sortNewestFirst(entries: NewsletterEntry[]): NewsletterEntry[] {
  return [...entries].sort((a, b) => b.issueDate.localeCompare(a.issueDate));
}

export function listPublishedNewsletters(): NewsletterEntry[] {
  return sortNewestFirst(registry.filter((entry) => entry.status === "published"));
}

export function getPublishedNewsletter(slug: string): NewsletterEntry | null {
  const entry = registry.find(
    (item) => item.slug === slug && item.status === "published",
  );
  return entry ?? null;
}

export function isKnownNewsletterSlug(slug: string): boolean {
  return registry.some((item) => item.slug === slug);
}

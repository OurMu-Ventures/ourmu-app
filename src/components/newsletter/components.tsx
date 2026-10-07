import Image from "next/image";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import "./newsletter.css";

/** Single masthead per issue. No page numbers or repeated headers. */
export function NewsletterMasthead({
  title,
  issueMonth,
  kicker = "Monthly newsletter for OURMU partners",
}: {
  title: string;
  issueMonth: string;
  kicker?: string;
}) {
  return (
    <header className="nl-masthead">
      <Image
        src="/logos/ourmu-color.png"
        alt="OURMU — Together for tomorrow"
        width={168}
        height={72}
        priority
        className="nl-logo"
      />
      <div className="nl-masthead-text">
        <p className="nl-kicker">{kicker}</p>
        <h1 className="nl-title">{title}</h1>
        <p className="nl-issue">
          <span className="nl-issue-badge">{issueMonth}</span>
          <span className="nl-issue-note">
            Historical issue; figures are editorial content, not live portfolio
            data.
          </span>
        </p>
      </div>
    </header>
  );
}

export function NewsletterSection({
  id,
  icon: Icon,
  title,
  children,
}: {
  id?: string;
  icon?: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id ? `${id}-title` : undefined} className="nl-panel">
      <h2 id={id ? `${id}-title` : undefined} className="nl-section-title">
        {Icon ? <Icon aria-hidden="true" className="nl-section-icon" /> : null}
        {title}
      </h2>
      <div className="nl-section-body">{children}</div>
    </section>
  );
}

export function NewsletterMetrics({
  items,
  ariaLabel,
}: {
  items: { label: string; value: string; sub?: string }[];
  ariaLabel: string;
}) {
  return (
    <dl aria-label={ariaLabel} className="nl-metrics">
      {items.map((item) => (
        <div key={item.label} className="nl-metric">
          <dt className="nl-metric-label">{item.label}</dt>
          <dd className="nl-metric-value">{item.value}</dd>
          {item.sub ? <dd className="nl-metric-sub">{item.sub}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

export function NewsletterPhoto({
  caption,
  description,
  placeholderLabel,
}: {
  caption: string;
  description: string;
  placeholderLabel: string;
}) {
  // Photographs are cropped from the PDF's embedded images during
  // production and placed under /public/newsletters/<slug>/.
  // Until those crops land, render an accessible placeholder that keeps
  // reading order, captions, and descriptions intact.
  return (
    <figure className="nl-photo">
      <div
        role="img"
        aria-label={description}
        className="nl-photo-placeholder"
      >
        <span aria-hidden="true">{placeholderLabel}</span>
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function NewsletterQuote({ children }: { children: ReactNode }) {
  return <blockquote className="nl-quote">{children}</blockquote>;
}

export function NewsletterCallout({
  icon: Icon,
  title,
  children,
  tone = "green",
}: {
  icon?: LucideIcon;
  title: string;
  children: ReactNode;
  tone?: "green" | "orange";
}) {
  return (
    <aside
      aria-label={title}
      className={`nl-callout nl-callout-${tone}`}
    >
      <h3 className="nl-callout-title">
        {Icon ? <Icon aria-hidden="true" className="nl-callout-icon" /> : null}
        {title}
      </h3>
      <div className="nl-callout-body">{children}</div>
    </aside>
  );
}

export function NewsletterFooter() {
  return (
    <footer className="nl-footer">
      <p>
        <strong>Have a question? We&apos;re here to help.</strong> If you have
        questions, need clarification, or want to share feedback, reach out to
        us.
      </p>
      <p>
        Email us:{" "}
        <a href="mailto:hello@ourmu.co">hello@ourmu.co</a> ·{" "}
        <a href="https://ourmu.co" target="_blank" rel="noreferrer">
          ourmu.co
        </a>
      </p>
    </footer>
  );
}

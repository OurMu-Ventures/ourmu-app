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
        src="/logos/ourmu-white.jpg"
        alt="OURMU — Together for tomorrow"
        width={240}
        height={162}
        preload
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
  compact = false,
}: {
  items: { label: string; value: string; sub?: string }[];
  ariaLabel: string;
  compact?: boolean;
}) {
  return (
    <dl
      aria-label={ariaLabel}
      className={`nl-metrics${compact ? " nl-metrics-compact" : ""}`}
    >
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
  src,
  width,
  height,
}: {
  caption: string;
  description: string;
  src: string;
  width: number;
  height: number;
}) {
  return (
    <figure className="nl-photo">
      <Image
        src={src}
        alt={description}
        width={width}
        height={height}
        sizes="(min-width: 1400px) 480px, (min-width: 900px) 40vw, 90vw"
        className="nl-photo-image"
      />
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

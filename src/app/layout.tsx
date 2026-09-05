import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OURMU Investor Portal", template: "%s · OURMU" },
  description: "Private, invite-only investor access for OURMU Ventures.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <SiteHeader />
        {children}
        <footer className="site-footer">
          <span>© {new Date().getFullYear()} OURMU Ventures</span>
          <span>Private investor portal · Investments involve risk</span>
        </footer>
      </body>
    </html>
  );
}

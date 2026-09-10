import type { Metadata, Viewport } from "next";
import { Open_Sans } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const openSans = Open_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-open-sans",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#102923",
};

export const metadata: Metadata = {
  title: { default: "OURMU Investor Portal", template: "%s · OURMU" },
  description: "Private, invite-only investor access for OURMU Ventures.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={openSans.variable}>
      <body className={openSans.className}>
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

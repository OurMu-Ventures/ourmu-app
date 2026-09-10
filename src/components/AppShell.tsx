import Link from "next/link";
import { LinkStatus } from "@/components/ui/link-status";
const investorLinks: [string, string, string][] = [
  ["/dashboard", "Overview", "Opening overview"],
  ["/profile", "Profile", "Opening profile"],
  ["/investments/new", "Invest", "Opening investment form"],
  ["/investments", "Investments", "Opening investments"],
  ["/account/closure", "Close account", "Opening account closure"],
];
const adminLinks: [string, string, string][] = [
  ["/admin", "Admin overview", "Opening admin overview"],
  ["/admin/invitations", "Invitations", "Opening invitations"],
  ["/admin/applications", "Applications", "Opening applications"],
  ["/admin/investors", "Investors", "Opening investors"],
  ["/admin/imports", "Imports", "Opening imports"],
  ["/admin/cycles", "Cycles", "Opening cycles"],
  ["/admin/investments", "Activations", "Opening activations"],
  ["/admin/audit", "Audit", "Opening audit log"],
  ["/admin/jobs", "Jobs", "Opening jobs"],
  ["/admin/settings", "Settings", "Opening settings"],
];
export function AppShell({
  children,
  admin = false,
}: {
  children: React.ReactNode;
  admin?: boolean;
}) {
  const links = admin ? adminLinks : investorLinks;
  return (
    <main id="main" className="shell">
      <nav
        className="side-nav"
        aria-label={admin ? "Administration" : "Investor portal"}
      >
        {links.map(([href, label, status]) => (
          <Link href={href} key={href}>
            {label} <LinkStatus label={status} />
          </Link>
        ))}
      </nav>
      <section className="shell-content">{children}</section>
    </main>
  );
}

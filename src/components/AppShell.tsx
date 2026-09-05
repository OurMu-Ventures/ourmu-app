import Link from "next/link";
const investorLinks = [
  ["/dashboard", "Overview"],
  ["/profile", "Profile"],
  ["/investments/new", "Invest"],
  ["/investments", "Investments"],
  ["/account/closure", "Close account"],
];
const adminLinks = [
  ["/admin", "Admin overview"],
  ["/admin/invitations", "Invitations"],
  ["/admin/applications", "Applications"],
  ["/admin/investors", "Investors"],
  ["/admin/cycles", "Cycles"],
  ["/admin/investments", "Activations"],
  ["/admin/audit", "Audit"],
  ["/admin/jobs", "Jobs"],
  ["/admin/settings", "Settings"],
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
        {links.map(([href, label]) => (
          <Link href={href} key={href}>
            {label}
          </Link>
        ))}
      </nav>
      <section className="shell-content">{children}</section>
    </main>
  );
}

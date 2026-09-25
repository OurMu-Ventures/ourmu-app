import { ShellNav, type ShellLink } from "@/components/ShellNav";
const partnerLinks: ShellLink[] = [
  { href: "/dashboard", label: "Overview", status: "Opening overview" },
  { href: "/profile", label: "Profile", status: "Opening profile" },
  {
    href: "/investments/new",
    label: "Invest",
    status: "Opening investment form",
  },
  { href: "/investments", label: "Investments", status: "Opening investments" },
];
const adminLinks: ShellLink[] = [
  { href: "/admin", label: "Admin overview", status: "Opening admin overview" },
  {
    href: "/admin/invitations",
    label: "Invitations",
    status: "Opening invitations",
  },
  {
    href: "/admin/applications",
    label: "Applications",
    status: "Opening applications",
  },
  { href: "/admin/partners", label: "Partners", status: "Opening partners" },
  { href: "/admin/imports", label: "Imports", status: "Opening imports" },
  { href: "/admin/cycles", label: "Cycles", status: "Opening cycles" },
  {
    href: "/admin/investments",
    label: "Activations",
    status: "Opening activations",
  },
  {
    href: "/admin/maturities",
    label: "Maturities",
    status: "Opening maturities",
  },
  { href: "/admin/audit", label: "Audit", status: "Opening audit log" },
  { href: "/admin/jobs", label: "Jobs", status: "Opening jobs" },
  { href: "/admin/settings", label: "Settings", status: "Opening settings" },
];
export function AppShell({
  children,
  admin = false,
}: {
  children: React.ReactNode;
  admin?: boolean;
}) {
  return (
    <main id="main" className="shell">
      <ShellNav
        links={admin ? adminLinks : partnerLinks}
        label={admin ? "Administration" : "Partner portal"}
      />
      <section className="shell-content">{children}</section>
    </main>
  );
}

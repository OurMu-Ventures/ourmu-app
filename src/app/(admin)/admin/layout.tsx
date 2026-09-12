import { requireAdmin } from "@/lib/auth";

// Minimal outer layout for everything under /admin. Deliberately free of
// navigation: the MFA page renders here, and any prefetching admin shell
// inside it would recurse through the proxy's AAL1 redirect. AAL2 console
// pages live under (console) with the full shell.
export default async function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin({ aal2: false });
  return <>{children}</>;
}

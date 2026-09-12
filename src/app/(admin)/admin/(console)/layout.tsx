import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "@/lib/auth";

// AAL2 console layout. The admin navigation shell (with its prefetching
// links) renders only here, after full AAL2 verification, so AAL1 sessions
// can never trigger prefetch recursion through the MFA redirect.
export default async function AdminConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return <AppShell admin>{children}</AppShell>;
}

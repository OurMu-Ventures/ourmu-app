import { signOut } from "@/actions/auth";
import { AppShell } from "@/components/AppShell";
import { requireInvestor } from "@/lib/auth";

export default async function InvestorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireInvestor();
  return (
    <AppShell>
      <div className="page-head">
        <div>
          <p className="eyebrow">Investor portal</p>
          <strong>{profile.legal_name}</strong>
        </div>
        <form action={signOut}>
          <button className="button-secondary" type="submit">
            Sign out
          </button>
        </form>
      </div>
      {children}
    </AppShell>
  );
}

import { InvestmentAccountSwitcher } from "@/components/InvestmentAccounts";
import { getInvestmentAccounts } from "@/lib/investment-accounts";
import { AppShell } from "@/components/AppShell";
import { requireInvestor } from "@/lib/auth";

export default async function PartnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireInvestor();
  const accounts = await getInvestmentAccounts(profile.id);
  return (
    <AppShell>
      <div className="page-head">
        <div>
          <p className="eyebrow">Partner portal</p>
          <strong>{profile.legal_name}</strong>
        </div>
      </div>
      <InvestmentAccountSwitcher accounts={accounts} />
      {children}
    </AppShell>
  );
}

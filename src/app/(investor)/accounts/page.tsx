import Link from "next/link";
import { InvestmentAccountForm } from "@/components/InvestmentAccounts";
import { requireInvestor } from "@/lib/auth";
import { getInvestmentAccounts } from "@/lib/investment-accounts";

export default async function AccountsPage() {
  const profile = await requireInvestor();
  const accounts = await getInvestmentAccounts(profile.id);
  return (
    <>
      <h1>Investment accounts</h1>
      <p>
        Keep separate investment balances under your verified name. Your partner
        investment limit applies across all accounts in each cycle.
      </p>
      {process.env.MULTIPLE_INVESTMENT_ACCOUNTS_ENABLED === "true" && (
        <section className="card">
          <h2>Open an account</h2>
          <InvestmentAccountForm />
        </section>
      )}
      <div className="cycle-list" style={{ marginTop: "1rem" }}>
        {accounts.map((account) => (
          <section className="card" key={account.id}>
            <h2>
              {account.name}
              {account.archived_at ? " (archived)" : ""}
            </h2>
            <Link href={`/dashboard?account=${account.id}`}>
              View balance and investments
            </Link>
            <InvestmentAccountForm account={account} />
          </section>
        ))}
      </div>
      <p className="notice">
        Account names organize your investments; all accounts belong to you.
        Reinvestment stays in its original account. Main Account remains open.
        Other accounts can be archived after their outstanding investments are
        settled; their history remains available.
      </p>
    </>
  );
}

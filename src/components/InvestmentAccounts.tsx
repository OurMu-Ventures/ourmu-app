"use client";

import Link from "next/link";
import { ACCOUNT_SCOPED_PATHS } from "@/lib/investment-account-context";
import { useActionState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { saveInvestmentAccount } from "@/actions/investment-accounts";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonVariants } from "@/components/ui/button";
import { initialActionState } from "@/lib/validation";

type Account = {
  id: string;
  name: string;
  is_default: boolean;
  archived_at: string | null;
};

export function InvestmentAccountSwitcher({
  accounts,
  accountId,
}: {
  accounts: Account[];
  accountId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (/^\/investments\/(?!new$)[^/]+$/.test(pathname) && !accountId)
    return null;
  const selected = accountId ?? params.get("account") ?? "all";
  return (
    <div className="form" style={{ marginBottom: "1.5rem", maxWidth: "28rem" }}>
      <label>
        Investment account
        <select
          value={selected}
          onChange={(event) => {
            const next = new URLSearchParams(params);
            next.set("account", event.target.value);
            // Detail pages belong to one investment; switching opens the chosen overview.
            const path = ACCOUNT_SCOPED_PATHS.includes(pathname)
              ? pathname
              : "/dashboard";
            router.push(`${path}?${next.toString()}`);
          }}
        >
          <option value="all">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
              {account.archived_at ? " (archived)" : ""}
            </option>
          ))}
        </select>
      </label>
      <Link href={`/accounts?account=${encodeURIComponent(selected)}`}>
        Manage accounts
      </Link>
    </div>
  );
}

export function InvestmentAccountForm({ account }: { account?: Account }) {
  const [state, action] = useActionState(
    saveInvestmentAccount,
    initialActionState,
  );
  return (
    <form action={action} className="form">
      <input type="hidden" name="accountId" value={account?.id ?? ""} />
      <label>
        Account name
        <input
          name="name"
          defaultValue={account?.name ?? ""}
          required
          maxLength={80}
          disabled={Boolean(account?.archived_at)}
        />
      </label>
      {!account?.archived_at && (
        <div className="account-actions">
          <SubmitButton className={buttonVariants()} pendingLabel="Saving…">
            {account ? "Save name" : "Open account"}
          </SubmitButton>
          {account && !account.is_default && (
            <SubmitButton
              className={buttonVariants({ variant: "secondary" })}
              pendingLabel="Archiving…"
              name="archive"
              value="true"
            >
              Archive account
            </SubmitButton>
          )}
        </div>
      )}
      {state.message && <p role="status">{state.message}</p>}
    </form>
  );
}

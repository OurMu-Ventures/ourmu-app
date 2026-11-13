export const ACCOUNT_SCOPED_PATHS = [
  "/dashboard",
  "/investments",
  "/investments/new",
  "/accounts",
];

export function accountHref(path: string, accountId: string | null) {
  return `${path}?account=${encodeURIComponent(accountId ?? "all")}`;
}

export function investmentAccountLabel(name: string, accountId: string) {
  return `${name} (ref ${accountId.replaceAll("-", "").slice(0, 8).toUpperCase()})`;
}

import type { Database } from "@/lib/database.types";

export type ApplicationView = "review" | "invitations" | "history";
export const APPLICATION_PAGE_SIZE = 25;
export function applicationView(value?: string | string[]): ApplicationView {
  return value === "invitations" || value === "history" ? value : "review";
}
export function applicationPage(value?: string | string[]) {
  const page = typeof value === "string" ? Number(value) : 1;
  return Number.isSafeInteger(page) && page > 0 && page <= 1_000_000 ? page : 1;
}
export function applicationsUrl(tab: ApplicationView, page = 1) {
  return `/admin/applications?tab=${tab}${page > 1 ? `&page=${page}` : ""}`;
}

type Application = Database["public"]["Tables"]["investor_applications"]["Row"];
export type ApplicationCard = Pick<
  Application,
  | "id"
  | "legal_name"
  | "email"
  | "phone"
  | "date_of_birth"
  | "address"
  | "district"
  | "country"
  | "created_at"
  | "reviewed_at"
  | "status"
>;
type Invitation =
  Database["public"]["Tables"]["application_invitations"]["Row"];
export type InvitationCard = Pick<
  Invitation,
  | "id"
  | "invited_email"
  | "created_at"
  | "expires_at"
  | "used_at"
  | "revoked_at"
>;
export function invitationStatus(item: InvitationCard, now: number) {
  return item.used_at
    ? "used"
    : item.revoked_at
      ? "revoked"
      : Date.parse(item.expires_at) <= now
        ? "expired"
        : "active";
}

// Explicit zones keep server rendering and browser hydration identical.
export function applicationDate(value: string) {
  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
export function applicationDateTime(value: string) {
  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Kampala",
  }).format(new Date(value));
}

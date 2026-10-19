import { ApplicationsWorkspace } from "@/components/ApplicationsWorkspace";
import { requireAdmin } from "@/lib/auth";
import {
  APPLICATION_PAGE_SIZE,
  applicationPage,
  applicationView,
} from "@/lib/application-views";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string | string[]; page?: string | string[] }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const tab = applicationView(params?.tab);
  const requestedPage = applicationPage(params?.page);
  const admin = createAdminClient();
  const pendingQuery = admin
    .from("investor_applications")
    .select("id", { count: "exact", head: true })
    .eq("status", "submitted");
  function listQuery(page: number) {
    const start = (page - 1) * APPLICATION_PAGE_SIZE;
    if (tab === "invitations") {
      return admin
        .from("application_invitations")
        .select("id,invited_email,created_at,expires_at,used_at,revoked_at", {
          count: "exact",
        })
        .order("created_at", { ascending: false })
        .order("id")
        .range(start, start + APPLICATION_PAGE_SIZE - 1);
    }
    let query = admin
      .from("investor_applications")
      .select(
        "id,legal_name,email,phone,date_of_birth,address,district,country,created_at,reviewed_at,status",
        { count: "exact" },
      );
    query =
      tab === "review"
        ? query.eq("status", "submitted")
        : query.in("status", ["approved", "rejected", "abandoned"]);
    return query
      .order("created_at", { ascending: tab === "review" })
      .order("id")
      .range(start, start + APPLICATION_PAGE_SIZE - 1);
  }
  const [pending, initial] = await Promise.all([
    pendingQuery,
    listQuery(requestedPage),
  ]);
  // Keep the client workspace mounted (and its confirmation visible) when the
  // final review on a page is completed and that page no longer exists.
  // PostgREST returns PGRST103 (HTTP 416) for an offset beyond the final
  // page, without a count. Re-query page one to recover the current count.
  const first =
    initial.error?.code === "PGRST103" && requestedPage > 1
      ? await listQuery(1)
      : initial;
  const page = first.error
    ? requestedPage
    : Math.min(
        requestedPage,
        Math.max(1, Math.ceil((first.count ?? 0) / APPLICATION_PAGE_SIZE)),
      );
  const result =
    page === requestedPage
      ? initial
      : page === 1 && first !== initial
        ? first
        : await listQuery(page);
  return (
    <ApplicationsWorkspace
      tab={tab}
      page={page}
      count={result.count ?? 0}
      pendingCount={pending.error ? null : (pending.count ?? 0)}
      applications={
        tab !== "invitations"
          ? (result.data ?? []).filter((item) => "legal_name" in item)
          : []
      }
      invitations={
        tab === "invitations"
          ? (result.data ?? []).filter((item) => "invited_email" in item)
          : []
      }
      loadError={Boolean(result.error)}
      now={new Date().getTime()}
    />
  );
}

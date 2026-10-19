import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

export default async function InvitationsPage() {
  await requireAdmin();
  redirect("/admin/applications?tab=invitations");
}

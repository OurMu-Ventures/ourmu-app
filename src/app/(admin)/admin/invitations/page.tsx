import { reissueInvitation, revokeInvitation } from "@/actions/applications";
import { InvitationForm } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
export default async function InvitationsPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin
    .from("application_invitations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  return (
    <>
      <p className="eyebrow">Controlled enrollment</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Invitations</h1>
      <div className="card">
        <InvitationForm />
      </div>
      <div className="table-wrap" style={{ marginTop: "1rem" }}>
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Expires</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((item) => (
              <tr key={item.id}>
                <td>{item.invited_email}</td>
                <td>{dateTime(item.expires_at)}</td>
                <td>
                  <span className="badge">
                    {item.used_at
                      ? "used"
                      : item.revoked_at
                        ? "revoked"
                        : new Date(item.expires_at) < new Date()
                          ? "expired"
                          : "active"}
                  </span>
                </td>
                <td>
                  {!item.used_at && (
                    <div className="hero-actions">
                      {!item.revoked_at && (
                        <form action={revokeInvitation}>
                          <input
                            type="hidden"
                            name="invitationId"
                            value={item.id}
                          />
                          <button type="submit">Revoke</button>
                        </form>
                      )}
                      <form action={reissueInvitation}>
                        <input
                          type="hidden"
                          name="invitationId"
                          value={item.id}
                        />
                        <button type="submit">Reissue</button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

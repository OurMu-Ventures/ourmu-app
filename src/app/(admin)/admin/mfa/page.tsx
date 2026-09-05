import { MfaPanel } from "@/components/MfaPanel";
import { requireAdmin } from "@/lib/auth";
export default async function AdminMfaPage() {
  await requireAdmin({ aal2: false });
  return (
    <>
      <p className="eyebrow">Administrator security</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Verify MFA</h1>
      <p>
        Administrator routes and sensitive actions require a TOTP authenticator
        and AAL2 session.
      </p>
      <MfaPanel />
    </>
  );
}

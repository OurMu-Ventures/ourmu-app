import { MfaPanel } from "@/components/MfaPanel";
import { requireAdmin } from "@/lib/auth";
import { resolveNextPath } from "@/lib/redirect";
export default async function AdminMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await requireAdmin({ aal2: false });
  const params = await searchParams;
  const target = resolveNextPath(params.next, "admin");
  return (
    <>
      <p className="eyebrow">Administrator security</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Verify MFA</h1>
      <p>
        Open the sign-in link in your email first — then enter the code from
        your authenticator app below. Administrator routes and sensitive
        actions require a TOTP authenticator and AAL2 session.
      </p>
      <MfaPanel target={target} />
    </>
  );
}

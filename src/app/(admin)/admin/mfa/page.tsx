import { MfaPanel } from "@/components/MfaPanel";
import { resolveNextPath } from "@/lib/redirect";

// Rendered under the minimal admin outer layout (role gate only), outside
// the navigation shell, so AAL1 rendering issues no admin prefetches.
export default async function AdminMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
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

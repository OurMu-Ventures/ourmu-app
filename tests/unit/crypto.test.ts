import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
describe("identity cryptography", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "a".repeat(30);
    process.env.SUPABASE_SERVICE_ROLE_KEY = "s".repeat(30);
    process.env.IDENTITY_MASTER_KEY_BASE64 = Buffer.alloc(32, 7).toString(
      "base64",
    );
    process.env.CRON_SECRET = "c".repeat(32);
    process.env.RESEND_FROM_EMAIL = "OURMU <test@example.com>";
    process.env.LEGAL_PRIVACY_VERSION = "test";
  });
  it("encrypts with random IVs and decrypts", async () => {
    const { encryptNin, decryptNin } = await import("@/lib/security/crypto");
    const a = encryptNin("CM 1234 5678 AB");
    const b = encryptNin("CM 1234 5678 AB");
    expect(a.ciphertext.toString("utf8")).not.toContain("CM12345678AB");
    expect(a.iv).not.toEqual(b.iv);
    expect(a.fingerprint).toEqual(b.fingerprint);
    expect(decryptNin(a)).toBe("CM12345678AB");
  });
  it("context-separates fingerprints", async () => {
    const { fingerprintRequestValue } = await import("@/lib/security/crypto");
    expect(fingerprintRequestValue("ip", "same")).not.toEqual(
      fingerprintRequestValue("invite", "same"),
    );
    expect(fingerprintRequestValue("account-email", "same")).not.toEqual(
      fingerprintRequestValue("alias-login-ip", "same"),
    );
  });
  it("creates opaque account email tokens with stable hashes", async () => {
    const { newAccountEmailToken, fingerprintRequestValue } = await import(
      "@/lib/security/crypto"
    );
    const value = newAccountEmailToken();
    expect(value.token).toHaveLength(43);
    expect(value.hash).toEqual(
      fingerprintRequestValue("account-email", value.token),
    );
  });
});

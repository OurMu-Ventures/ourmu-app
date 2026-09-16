import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { getServerEnv } from "@/lib/env";

const KEY_VERSION = 1;

function masterKey() {
  const key = Buffer.from(getServerEnv().IDENTITY_MASTER_KEY_BASE64, "base64");
  if (key.length !== 32)
    throw new Error(
      "IDENTITY_MASTER_KEY_BASE64 must decode to exactly 32 bytes",
    );
  return key;
}

function derive(info: string) {
  return Buffer.from(
    hkdfSync(
      "sha256",
      masterKey(),
      Buffer.from("ourmu-v1"),
      Buffer.from(info),
      32,
    ),
  );
}

export function normalizeNin(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function encryptNin(nin: string) {
  const normalized = normalizeNin(nin);
  if (normalized.length < 8 || normalized.length > 32)
    throw new Error("Invalid NIN format");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive("nin-encryption"), iv);
  cipher.setAAD(Buffer.from(`investor-nin:v${KEY_VERSION}`));
  const ciphertext = Buffer.concat([
    cipher.update(normalized, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext,
    iv,
    authTag: cipher.getAuthTag(),
    fingerprint: createHmac("sha256", derive("nin-fingerprint"))
      .update(normalized)
      .digest(),
    lastFour: normalized.slice(-4),
    keyVersion: KEY_VERSION,
  };
}

export function decryptNin(envelope: {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}) {
  if (envelope.keyVersion !== KEY_VERSION)
    throw new Error("Unsupported identity key version");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    derive("nin-encryption"),
    envelope.iv,
  );
  decipher.setAAD(Buffer.from(`investor-nin:v${envelope.keyVersion}`));
  decipher.setAuthTag(envelope.authTag);
  return Buffer.concat([
    decipher.update(envelope.ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

export function fingerprintRequestValue(
  context: "ip" | "invite" | "account-email" | "alias-login-ip",
  value: string,
) {
  return createHmac("sha256", derive(`${context}-fingerprint`))
    .update(value.trim().toLowerCase())
    .digest();
}

export function newInviteToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: fingerprintRequestValue("invite", token) };
}

export function newAccountEmailToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: fingerprintRequestValue("account-email", token) };
}

export function safeSecretEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function maskNin(lastFour: string | null) {
  return lastFour ? `********${lastFour}` : "Not available";
}

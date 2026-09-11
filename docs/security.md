# Security and privacy model

NIN input is normalized and encrypted server-side with AES-256-GCM, a random 96-bit IV, authenticated context, and versioned keys. A keyed HMAC fingerprint enforces uniqueness without deterministic encryption. Encryption, NIN-fingerprint, invite-fingerprint, and IP-fingerprint keys are derived from one server-only 256-bit master key using HKDF with separate contexts.

Only ciphertext, IV, authentication tag, keyed fingerprint, last four characters, and key version enter PostgreSQL. The envelope lives in the non-exposed `private` schema. Rejected applications lose ciphertext and uniqueness fingerprint immediately. A scheduled task anonymizes rejected/abandoned applications after 30 days.

Partner reveal requires a fresh email-authenticated session (within ten minutes). Administrator reveal requires TOTP AAL2. Every reveal produces an append-only audit event, and the response is not cached.

## Authorization

- Unrestricted Supabase email sign-up is disabled locally and must also be disabled in production.
- RLS is enabled on every exposed application table; grants are explicit.
- Browser roles have no write grant on protected records.
- Server Actions authenticate and authorize independently; Proxy only refreshes sessions and provides optimistic route gating.
- Financial RPC execution is revoked from `PUBLIC`, `anon`, and `authenticated` and granted to `service_role` alone.

Logs may contain request IDs, action names, entity UUIDs, status codes, durations, and safe error codes. They must never contain NIN, decrypted identity data, bank reference, invite token, magic link, signed URL, service-role/database/age secret, or raw job payload.

For key rotation, introduce a new version, retain old decryption material temporarily, re-encrypt rows in a controlled no-log job, verify counts, then retire the old key after backup retention and rollback windows. Never overwrite a production master key in place.

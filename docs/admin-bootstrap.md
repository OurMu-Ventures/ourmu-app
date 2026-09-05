# First administrator bootstrap

Perform this manually as a Supabase project owner over a trusted connection.

1. Create exactly one email-confirmed user in Supabase Dashboard → Authentication → Users. Do not enable public sign-up.
2. Copy that user's UUID and run this in SQL Editor after replacing every example value:

```sql
insert into public.profiles (id, role, access_status, legal_name, email, kyc_status, kyc_verified_at)
values ('USER_UUID', 'admin', 'active', 'ADMIN_LEGAL_NAME', 'admin@example.com', 'verified', now());
```

3. Send the administrator a magic link from Auth or portal login.
4. On first access, enroll TOTP and reach AAL2 at `/admin/mfa`.
5. Verify audit access and configure receiving bank instructions. Never store role in user metadata.

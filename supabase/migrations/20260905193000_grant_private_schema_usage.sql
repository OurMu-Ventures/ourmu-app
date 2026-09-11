begin;

-- Schema USAGE permits resolving explicitly granted functions and tables; it
-- does not grant access to the encrypted identity table itself.
grant usage on schema private to authenticated, service_role;

commit;

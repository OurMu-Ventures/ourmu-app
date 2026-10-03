begin;

-- The resolver runs inside security-invoker RPCs executed by service_role.
-- Grant it the same way as other private helpers so submissions, reservations,
-- activations, and fulfillment can resolve without direct browser access.
grant execute on function private.resolve_portal_cycle(timestamptz) to service_role;
grant execute on function private.resolve_portal_cycle(timestamptz) to authenticated;

notify pgrst, 'reload schema';
commit;

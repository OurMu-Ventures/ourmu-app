# Encrypted backup and restore

Daily CI creates a custom-format `pg_dump`, encrypts it to the public age recipient, and retains it for 30 days. The private identity remains a GitHub secret and in the organization's offline recovery process.

Monthly CI makes a fresh encrypted dump, decrypts only inside the runner, restores to ephemeral PostgreSQL 17, and verifies expected tables, migration history, and aggregate counts without printing rows. Quarterly, an authorized operator should independently restore one artifact, document safe counts, then dispose of plaintext.

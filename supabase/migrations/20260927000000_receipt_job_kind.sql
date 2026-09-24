-- Additive receipt job kind. Runs outside an explicit transaction because
-- Postgres does not allow ALTER TYPE ... ADD VALUE inside a transaction block.
alter type public.job_kind add value if not exists 'generate_receipt_pdf';

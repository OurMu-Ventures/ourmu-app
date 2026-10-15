-- Commit the enum addition before using it in constraints/functions.
alter type public.receipt_source add value if not exists 'investment_record';

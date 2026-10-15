alter table public.investments add column alias text
  constraint investment_alias_length check (alias is null or (char_length(alias) between 1 and 80 and alias = btrim(alias)));

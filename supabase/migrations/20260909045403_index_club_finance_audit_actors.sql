begin;

create index if not exists financial_recurring_rules_created_by_idx
  on public.financial_recurring_rules (created_by)
  where created_by is not null;

create index if not exists financial_transactions_created_by_idx
  on public.financial_transactions (created_by)
  where created_by is not null;

create index if not exists financial_transactions_updated_by_idx
  on public.financial_transactions (updated_by)
  where updated_by is not null;

commit;

begin;

create index if not exists financial_transactions_student_id_idx
  on public.financial_transactions (student_id)
  where student_id is not null;

commit;

-- Cobre a chave estrangeira usada ao desvincular um perfil da auditoria do balcão.
create index if not exists bar_counter_sale_mutations_created_by_idx
  on public.bar_counter_sale_mutations(created_by)
  where created_by is not null;

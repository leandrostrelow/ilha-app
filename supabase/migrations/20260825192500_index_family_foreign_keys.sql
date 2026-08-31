begin;

-- Keep foreign-key validation and parent-row updates predictable as family
-- accounts grow. These are additive B-tree indexes and do not alter data.
create index if not exists app_family_members_reviewed_by_idx
  on public.app_family_members (reviewed_by)
  where reviewed_by is not null;

create index if not exists app_family_member_audit_actor_idx
  on public.app_family_member_audit (actor_id)
  where actor_id is not null;

create index if not exists app_family_invoice_items_family_member_idx
  on public.app_family_invoice_items (family_member_id)
  where family_member_id is not null;

create index if not exists app_family_invoice_items_beneficiary_idx
  on public.app_family_invoice_items (beneficiary_client_id)
  where beneficiary_client_id is not null;

commit;

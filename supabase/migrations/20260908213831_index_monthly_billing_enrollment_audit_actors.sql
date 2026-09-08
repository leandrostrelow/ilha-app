create index app_monthly_billing_enrollments_enabled_by_idx
  on public.app_monthly_billing_enrollments (enabled_by)
  where enabled_by is not null;

create index app_monthly_billing_enrollments_updated_by_idx
  on public.app_monthly_billing_enrollments (updated_by)
  where updated_by is not null;

create index app_monthly_billing_enrollment_audit_changed_by_idx
  on public.app_monthly_billing_enrollment_audit (changed_by, created_at desc)
  where changed_by is not null;

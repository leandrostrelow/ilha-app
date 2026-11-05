begin;
alter table public.lesson_slots drop constraint if exists lesson_slots_capacity_max_four;
alter table public.lesson_slots add constraint lesson_slots_capacity_positive check (capacity > 0);
-- Keep the default of four and all existing enrollment/update guards.
commit;

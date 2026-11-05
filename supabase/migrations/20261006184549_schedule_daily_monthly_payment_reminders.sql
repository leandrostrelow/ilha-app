begin;
-- 09:30 America/Sao_Paulo (UTC-03). The unique reminder key also makes manual
-- retries safe. Existing push dispatcher handles delivery, not a second queue.
select cron.schedule('ilha-play-monthly-payment-reminders','30 12 * * *',
  'select public.enqueue_due_monthly_payment_reminders();');
commit;

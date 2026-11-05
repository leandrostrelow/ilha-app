begin;
create index monthly_receipt_batches_client_idx on private.monthly_receipt_batches(client_id);
create index monthly_receipt_batches_actor_idx on private.monthly_receipt_batches(actor_id);
commit;

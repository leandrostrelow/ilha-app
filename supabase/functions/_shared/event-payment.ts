import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { storeProviderConfig, type StoreRecord } from "./store-payment.ts";
export async function reconcileEventPayment(db: SupabaseClient, order: StoreRecord, payment: StoreRecord) {
  if (payment.billingType !== "PIX") throw new Error("Forma de pagamento divergente do ingresso.");
  const status = payment.deleted === true ? "DELETED" : String(payment.status || "");
  const { data,error } = await db.rpc("event_reconcile_payment", {
    p_order:order.id,p_payment:payment.id,p_environment:storeProviderConfig().environment,
    p_reference:payment.externalReference,p_amount:Math.round(Number(payment.value)*100),p_status:status,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.id) throw new Error("O pagamento ainda está sendo processado.");
  return result as StoreRecord;
}

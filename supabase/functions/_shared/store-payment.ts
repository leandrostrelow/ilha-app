import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
export type StoreRecord = Record<string, any>;
// Asaas static Pix descriptions are limited to 37 characters. Keep the full
// cart in our order items; this ASCII reference also fits the Pix byte limit.
export const storeStaticPixDescription = (orderId: string) => `Ilha Store - ${orderId.slice(0,8)}`;

export class StoreProviderError extends Error {
  constructor(readonly status: number, readonly rejectedStaticDescription = false) {
    super(rejectedStaticDescription
      ? "O Asaas recusou a descrição do Pix. Consulte este mesmo pedido para tentar novamente."
      : "O Asaas não concluiu a operação. Consulte o pedido antes de tentar novamente.");
  }
}
export function storeProviderConfig() {
  const base = (Deno.env.get("ASAAS_BASE_URL") || "").replace(/\/+$/, "");
  const key = Deno.env.get("ASAAS_API_KEY") || "";
  const environment = base === "https://api.asaas.com/v3" ? "PRODUCTION" : base === "https://api-sandbox.asaas.com/v3" ? "SANDBOX" : "";
  if (!environment || !key.startsWith(environment === "PRODUCTION" ? "$aact_prod_" : "$aact_hmlg_")) throw new Error("Pagamento Asaas não configurado.");
  return { base, key, environment };
}
export async function storeProvider(path: string, method = "GET", body?: StoreRecord): Promise<StoreRecord> {
  const { base, key } = storeProviderConfig();
  const response = await fetch(base + path, {
    method, signal: AbortSignal.timeout(12000),
    headers: { access_token: key, "Content-Type": "application/json", "User-Agent": "IlhaPlay-Store/1.0" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    // Only this explicit validation rejection proves no QR was created. Other
    // failures (including timeouts/5xx) remain lookup-only to prevent duplicates.
    const rejectedStaticDescription = method === "POST" && path === "/pix/qrCodes/static" && response.status === 400
      && Array.isArray(failure?.errors) && failure.errors.length === 1
      && failure.errors[0]?.code === "invalid_action"
      && failure.errors[0]?.description === "A descrição deste QR Code não deve ultrapassar 37 caracteres.";
    console.error("store_provider_error", JSON.stringify({
      operation: method === "POST" && path === "/pix/qrCodes/static" ? "create_static_pix" : "store_payment_operation",
      status: response.status, reason: rejectedStaticDescription ? "static_description_limit" : "provider_rejected",
    }));
    throw new StoreProviderError(response.status, rejectedStaticDescription);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}
export async function reconcileStorePayment(db: SupabaseClient, order: StoreRecord, payment: StoreRecord) {
  const status = payment.deleted === true ? "DELETED" : String(payment.status || "");
  if (payment.billingType !== "PIX") throw new Error("Forma de pagamento divergente.");
  if (order.provider_qr_code_id && String(payment.pixQrCodeId || "") !== String(order.provider_qr_code_id)) {
    throw new Error("O pagamento não pertence ao QR Code desta venda.");
  }
  const { data, error } = await db.rpc("store_reconcile_payment", {
    p_order: order.id, p_payment: payment.id, p_environment: storeProviderConfig().environment,
    p_reference: payment.externalReference, p_amount: payment.value, p_status: status,
  });
  if (error) throw error;
  const orderResult = Array.isArray(data) ? data[0] : data;
  if (!orderResult || typeof orderResult.id !== "string") throw new Error("O banco não confirmou o pedido.");
  return orderResult as StoreRecord;
}

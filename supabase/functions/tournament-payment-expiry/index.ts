import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

type Row = Record<string, unknown>;
type DbClient = SupabaseClient<any, "public", "public", any>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function serviceRoleKey() {
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyKey) return legacyKey;
  const currentKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!currentKeys) return "";
  try {
    const parsed = JSON.parse(currentKeys);
    return parsed.default || "";
  } catch (_error) {
    return currentKeys.startsWith("sb_secret_") ? currentKeys : "";
  }
}

function asaasConfig() {
  const apiKey = Deno.env.get("ASAAS_API_KEY") || "";
  const baseUrl = (Deno.env.get("ASAAS_BASE_URL") || "").replace(/\/+$/, "");
  if (!apiKey || !new Set(["https://api-sandbox.asaas.com/v3", "https://api.asaas.com/v3"]).has(baseUrl)) {
    throw new Error("Configuração de pagamento indisponível.");
  }
  return { apiKey, baseUrl };
}

async function asaasRequest(path: string, init: RequestInit = {}) {
  const { apiKey, baseUrl } = asaasConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "IlhaTenis-Torneios/1.0",
        "access_token": apiKey,
        ...(init.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({})) as Row;
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function providerStatus(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

async function confirmLocally(client: DbClient, payment: Row, status: "RECEIVED" | "CONFIRMED") {
  const now = new Date().toISOString();
  const updated = await client.from("tournament_payments").update({
    status,
    paid_at: now,
    updated_at: now,
  }).eq("id", payment.id).in("status", ["CREATED", "PENDING", "FAILED", "OVERDUE"]).select("id").maybeSingle();
  if (updated.error) throw updated.error;
  if (!updated.data) return false;
  const synced = await client.rpc("sync_tournament_registration_payment_group", {
    p_primary_registration_id: payment.registration_id,
    p_registration_status: "CONFIRMED",
    p_payment_status: "PAID",
    p_paid_amount: Number(payment.amount || 0),
    p_confirmed_at: now,
    p_cancelled_at: null,
  });
  if (synced.error) throw synced.error;
  return true;
}

async function archiveLocally(client: DbClient, paymentId: unknown) {
  const result = await client.rpc("archive_expired_tournament_payment", { p_payment_id: paymentId });
  if (result.error) throw result.error;
  return result.data === true;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = serviceRoleKey();
  if (!supabaseUrl || !serviceKey) return json({ error: "Serviço indisponível." }, 503);
  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const pending = await client.from("tournament_payments")
    .select("id,registration_id,provider_payment_id,status,amount,expires_at")
    .in("status", ["CREATED", "PENDING", "FAILED", "OVERDUE"])
    .not("expires_at", "is", null)
    .lte("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true })
    .limit(50);
  if (pending.error) {
    console.error("tournament-payment-expiry lookup failed", { code: pending.error.code || "database_error" });
    return json({ error: "Não foi possível verificar as cobranças." }, 500);
  }

  const summary = { checked: pending.data?.length || 0, expired: 0, confirmed: 0, deferred: 0 };
  for (const payment of (pending.data || []) as Row[]) {
    try {
      const providerPaymentId = String(payment.provider_payment_id || "").trim();
      if (!providerPaymentId) {
        if (await archiveLocally(client, payment.id)) summary.expired += 1;
        continue;
      }

      const remote = await asaasRequest(`/payments/${encodeURIComponent(providerPaymentId)}`);
      if (remote.ok) {
        const status = providerStatus(remote.body.status);
        if (status === "RECEIVED" || status === "CONFIRMED") {
          if (await confirmLocally(client, payment, status)) summary.confirmed += 1;
          continue;
        }
        if (status === "REFUNDED" || status === "CHARGEBACK") {
          const now = new Date().toISOString();
          const localStatus = status === "REFUNDED" ? "REFUNDED" : "CHARGEBACK";
          const registrationStatus = status === "REFUNDED" ? "REFUNDED" : "CANCELLED";
          const paymentStatus = status === "REFUNDED" ? "REFUNDED" : "CANCELLED";
          const paymentUpdate = await client.from("tournament_payments")
            .update({ status: localStatus, updated_at: now }).eq("id", payment.id);
          if (paymentUpdate.error) throw paymentUpdate.error;
          const sync = await client.rpc("sync_tournament_registration_payment_group", {
            p_primary_registration_id: payment.registration_id,
            p_registration_status: registrationStatus,
            p_payment_status: paymentStatus,
            p_paid_amount: 0,
            p_confirmed_at: null,
            p_cancelled_at: now,
          });
          if (sync.error) throw sync.error;
          continue;
        }
      } else if (remote.status !== 404) {
        summary.deferred += 1;
        continue;
      }

      const removed = await asaasRequest(`/payments/${encodeURIComponent(providerPaymentId)}`, { method: "DELETE" });
      if (!removed.ok && removed.status !== 404) {
        summary.deferred += 1;
        continue;
      }
      if (await archiveLocally(client, payment.id)) summary.expired += 1;
    } catch (error) {
      summary.deferred += 1;
      console.error("tournament-payment-expiry item deferred", {
        payment_id: payment.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return json(summary);
});

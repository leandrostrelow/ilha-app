import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { appCorsHeaders } from "../_shared/cors.ts";
import { reconcileStorePayment, storeProvider, storeProviderConfig, storeStaticPixDescription, StoreProviderError, type StoreRecord } from "../_shared/store-payment.ts";

const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
function validCpf(value: string) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  for (let len = 9; len <= 10; len++) {
    const sum = value.slice(0, len).split("").reduce((n, d, i) => n + Number(d) * (len + 1 - i), 0);
    const digit = (sum * 10) % 11 % 10;
    if (digit !== Number(value[len])) return false;
  }
  return true;
}
function secretKey() {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
  try { return JSON.parse(keys).default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""; }
  catch { return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || (keys.startsWith("sb_secret_") ? keys : ""); }
}
async function activeStorePixAddressKey() {
  const configured = String(Deno.env.get("ASAAS_PIX_ADDRESS_KEY") || "").trim();
  if (configured) return configured;
  const response = await storeProvider("/pix/addressKeys?status=ACTIVE&limit=2");
  const keys = Array.isArray(response.data) ? response.data : [];
  const active = keys.find((item: StoreRecord) => item?.status === "ACTIVE" && typeof item?.key === "string" && item.key.trim());
  if (!active) throw new Error("Cadastre uma chave Pix ativa no Asaas para usar a venda avulsa sem CPF.");
  return String(active.key).trim();
}

Deno.serve(async (request) => {
  const headers = { ...appCorsHeaders(request, "POST, OPTIONS"), "Content-Type": "application/json", "Cache-Control": "no-store" };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ error: "Método inválido." }, 405);
  let orderId = "";
  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Entre na sua conta." }, 401);
    const url = Deno.env.get("SUPABASE_URL") || "";
    const db = createClient(url, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Sessão expirada. Entre novamente." }, 401);
    const userDb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") || secretKey(), {
      global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
    });
    const { data: staff, error: permissionError } = await userDb.rpc("has_club_permission", { p_permission: "store" });
    if (permissionError) throw new Error("Não foi possível verificar o acesso à loja.");
    const raw = await request.text();
    if (raw.length > 12000) return json({ error: "Pedido muito grande." }, 413);
    const body = JSON.parse(raw);
    const action = body.action;
    if (action === "capabilities") return json({ can_sell: staff === true });
    if (action === "readiness") {
      if (!staff) return json({ error: "Acesso exclusivo da equipe." }, 403);
      const { environment } = storeProviderConfig();
      return json({ configured: true, environment });
    }
    if (action === "list") {
      let query = db.from("app_store_orders").select("id,customer_name,product_name,quantity,total,status,source,provider_environment,created_at,delivered_at,items:app_store_order_items(product_id,product_name,quantity,unit_price,total)").order("created_at", { ascending: false }).limit(100);
      if (!staff || body.admin !== true) query = query.or(`client_id.eq.${auth.user.id},created_by.eq.${auth.user.id}`);
      const { data, error } = await query;
      if (error) throw error;
      return json({ orders: data });
    }
    const { environment } = storeProviderConfig();
    let order: StoreRecord;
    let customer: StoreRecord = {};
    if (action === "create") {
      // Old clients still send one product. All new carts reserve atomically.
      const items = body.items === undefined ? [{ product_id: body.product_id, quantity: body.quantity }] : body.items;
      if (!uuid(body.request_id) || !Array.isArray(items) || items.length < 1 || items.length > 20
        || items.some((item: StoreRecord) => !item || !uuid(item.product_id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50)
        || items.reduce((total: number, item: StoreRecord) => total + item.quantity, 0) > 50) throw new Error("Adicione até 20 produtos e 50 unidades no total, com quantidades inteiras.");
      const presencial = body.source === "PRESENCIAL";
      if (presencial && !staff) return json({ error: "Venda presencial exclusiva da equipe." }, 403);
      const clientId = presencial ? body.client_id || null : auth.user.id;
      if (clientId) {
        if (!uuid(clientId)) throw new Error("Cliente inválido.");
        const { data, error } = await db.from("app_clients").select("full_name,cpf,email,phone").eq("id", clientId).single();
        if (error || !data) throw new Error("Complete o cadastro antes de comprar.");
        customer = data;
      } else {
        customer = { full_name: String(body.customer_name || "").trim().slice(0,120) };
      }
      if (String(customer.full_name || "").trim().length < 3) throw new Error("Informe o nome do comprador.");
      if (clientId) {
        const cpf = String(customer.cpf || "").replace(/\D/g, "");
        if (!validCpf(cpf)) throw new Error("O cliente selecionado precisa ter um CPF válido para gerar o Pix.");
        customer.cpf = cpf;
      }
      const { data, error } = await db.rpc("store_reserve_cart", {
        p_actor: auth.user.id, p_client: clientId, p_name: customer.full_name, p_source: presencial ? "PRESENCIAL" : "APP",
        p_request: body.request_id, p_items: items.map((item: StoreRecord) => ({ product_id: item.product_id, quantity: item.quantity })), p_environment: environment,
      });
      if (error) throw error;
      order = Array.isArray(data) ? data[0] : data;
      if (!order || !uuid(order.id)) throw new Error("O banco não confirmou a reserva.");
    } else {
      if (!uuid(body.order_id)) throw new Error("Pedido inválido.");
      const { data, error } = await db.from("app_store_orders").select("*").eq("id", body.order_id).single();
      if (error || !data || (!staff && data.client_id !== auth.user.id)) return json({ error: "Pedido não encontrado." }, 404);
      order = data;
    }
    orderId = order.id;
    const { data: orderItems, error: itemsError } = await db.from("app_store_order_items")
      .select("product_id,product_name,quantity,unit_price,total").eq("order_id", order.id).order("product_name");
    if (itemsError || !orderItems?.length) throw new Error("Não foi possível conferir os itens deste pedido. Consulte novamente.");
    const withItems = (value: StoreRecord) => ({ ...value, items: orderItems });
    const description = "Ilha Store • " + orderItems.map(item => `${item.quantity}x ${item.product_name}`).join("; ");
    if (order.provider_environment !== environment) throw new Error("Pedido de outro ambiente de pagamento.");
    const reference = `ilha-store:${order.id}`;
    let payment: StoreRecord | undefined;
    if (order.provider_payment_id) payment = await storeProvider(`/payments/${encodeURIComponent(order.provider_payment_id)}`);
    else if (order.provider_qr_code_id && (action === "cancel" || body.provider_check === true)) {
      const found = await storeProvider(`/payments?pixQrCodeId=${encodeURIComponent(order.provider_qr_code_id)}&limit=2`);
      if ((found.data || []).length > 1) throw new Error("Mais de um pagamento encontrado para este QR Code. Peça revisão ao clube.");
      payment = found.data?.[0];
    }
    else {
      const found = await storeProvider(`/payments?externalReference=${encodeURIComponent(reference)}&limit=2`);
      if ((found.data || []).length > 1) throw new Error("Mais de uma cobrança encontrada. Peça revisão ao clube.");
      payment = found.data?.[0];
    }
    // Manual consultation can recover a positively rejected guest QR on the
    // existing reservation. Polls and ambiguous attempts never create a new Pix.
    const canPreparePix = action === "create" || (action === "status" && body.provider_check === true && order.payment_flow === "STATIC_QR");
    if (!payment && canPreparePix && !order.payment_attempted_at && !order.provider_qr_code_id && !order.provider_payment_id && order.status === "CREATED") {
      const staticQr = order.payment_flow === "STATIC_QR";
      const addressKey = staticQr ? await activeStorePixAddressKey() : "";
      // Claim BEFORE the provider POST. An ambiguous timeout is lookup-only on retry.
      const attemptedAt = new Date().toISOString();
      const claim = await db.from("app_store_orders").update({ payment_attempted_at: attemptedAt })
        .eq("id", order.id).is("payment_attempted_at", null).eq("status", "CREATED").select("id").maybeSingle();
      if (claim.error) throw claim.error;
      if (!claim.data) throw new Error("O Pix já está sendo gerado. Consulte este pedido em alguns segundos.");
      if (staticQr) {
        let qr: StoreRecord;
        try {
          qr = await storeProvider("/pix/qrCodes/static", "POST", {
            addressKey, description: storeStaticPixDescription(order.id),
            value: Number(order.total), format: "ALL", expirationSeconds: 3600,
            allowsMultiplePayments: false, externalReference: reference,
          });
        } catch (error) {
          if (error instanceof StoreProviderError && error.rejectedStaticDescription) {
            const reset = await db.from("app_store_orders").update({ payment_attempted_at: null })
              .eq("id", order.id).eq("status", "CREATED").eq("payment_flow", "STATIC_QR")
              .eq("payment_attempted_at", attemptedAt).is("provider_qr_code_id", null)
              .is("provider_payment_id", null).is("pix_payload", null);
            if (reset.error) console.error("store_static_pix_retry_reset_failed");
          }
          throw error;
        }
        if (typeof qr.id !== "string" || typeof qr.payload !== "string" || typeof qr.encodedImage !== "string"
          || !/^[A-Za-z0-9+/=]+$/.test(qr.encodedImage)) throw new Error("O Asaas não devolveu um QR Code válido.");
        const attached = await db.rpc("store_attach_static_qr", {
          p_order: order.id, p_qr_code: qr.id, p_payload: qr.payload,
          p_image: qr.encodedImage, p_expires: qr.expirationDate || "",
        });
        if (attached.error) throw attached.error;
        order = Array.isArray(attached.data) ? attached.data[0] : attached.data;
      } else {
        const lookup = await storeProvider(`/customers?cpfCnpj=${encodeURIComponent(customer.cpf)}&limit=1`);
        let customerId = lookup.data?.[0]?.id;
        if (!customerId) {
          const created = await storeProvider("/customers", "POST", { name: customer.full_name, cpfCnpj: customer.cpf,
            email: customer.email || undefined, mobilePhone: customer.phone || undefined, notificationDisabled: true });
          customerId = created.id;
        }
        const dueDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        payment = await storeProvider("/payments", "POST", { customer: customerId, billingType: "PIX", value: Number(order.total),
          dueDate, externalReference: reference, description: description.slice(0,500),
          interest: { value: 0 }, fine: { value: 0 } });
      }
    }
    if (payment) order = await reconcileStorePayment(db, order, payment);
    if (action === "cancel") {
      if (!["CREATED", "PENDING"].includes(order.status)) throw new Error("Pedido pago ou em revisão não pode ser cancelado aqui. Procure o financeiro.");
      if (order.payment_flow === "STATIC_QR" && order.provider_qr_code_id) {
        await storeProvider(`/pix/qrCodes/static/${encodeURIComponent(order.provider_qr_code_id)}`, "DELETE");
        const cancelled = await db.rpc("store_cancel_static_qr", { p_order: order.id, p_qr_code: order.provider_qr_code_id });
        if (cancelled.error) throw cancelled.error;
        return json({ order: withItems(Array.isArray(cancelled.data) ? cancelled.data[0] : cancelled.data) });
      }
      if (!payment) {
        const cancelled = await db.rpc("store_cancel_unattempted", { p_order: order.id });
        if (cancelled.error) throw new Error("Cobrança ainda não localizada. Não liberamos o estoque enquanto o Asaas não confirmar o cancelamento.");
        return json({ order: withItems(Array.isArray(cancelled.data) ? cancelled.data[0] : cancelled.data) });
      }
      const cancelled = await storeProvider(`/payments/${encodeURIComponent(payment.id)}`, "DELETE");
      if (cancelled.deleted !== true) throw new Error("Cancelamento não confirmado pelo Asaas.");
      order = await reconcileStorePayment(db, order, { ...payment, deleted: true });
    } else if (action === "deliver") {
      if (!staff) return json({ error: "Apenas a equipe pode entregar produtos." }, 403);
      const updated = await db.from("app_store_orders").update({ delivered_at: new Date().toISOString() })
        .eq("id", order.id).eq("status", "PAID").is("delivered_at", null).select("*").maybeSingle();
      if (updated.error) throw updated.error;
      if (!updated.data && !order.delivered_at) throw new Error("Aguarde o recebimento do pagamento antes da entrega.");
      order = updated.data || order;
    } else if (!["create", "status"].includes(action)) throw new Error("Ação inválida.");
    if (payment && ["CREATED", "PENDING"].includes(order.status) && !order.pix_payload) {
      const pix = await storeProvider(`/payments/${encodeURIComponent(payment.id)}/pixQrCode`);
      if (typeof pix.payload !== "string" || typeof pix.encodedImage !== "string" || !/^[A-Za-z0-9+/=]+$/.test(pix.encodedImage)) throw new Error("QR Code ainda não disponível. Consulte novamente.");
      const updated = await db.from("app_store_orders").update({ pix_payload: pix.payload, pix_image: pix.encodedImage, pix_expires_at: pix.expirationDate })
        .eq("id", order.id).in("status", ["CREATED", "PENDING"]).select("*").maybeSingle();
      if (updated.error) throw updated.error;
      if (updated.data) order = updated.data;
    }
    return json({ order: withItems(order), pending_provider: order.payment_flow === "CHARGE" && !payment });
  } catch (error) {
    // Never return provider bodies, credentials or buyer CPF in logs/errors.
    const message = error instanceof Error ? error.message : "Não foi possível concluir o pedido. Consulte novamente.";
    return json({ error: message, order_id: orderId || undefined }, 400);
  }
});

type Row = Record<string, any>;

const accessCodeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch (_error) {
    return "";
  }
}

function providerErrorCode(value: unknown) {
  const code = String(value || "provider_error").toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").slice(0, 80);
  return code.length >= 2 ? code : "provider_error";
}

async function hmacSha256(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function derivePredictionAccessCode(rateLimitSalt: string, requestId: string) {
  const digest = await hmacSha256(rateLimitSalt, `palpite-code:${requestId}`);
  let code = "";
  for (let index = 0; index < 20; index += 2) {
    const byte = Number.parseInt(digest.slice(index, index + 2), 16);
    code += accessCodeAlphabet[byte % accessCodeAlphabet.length];
  }
  return code;
}

export function predictionEmailConfigured() {
  const apiKey = (Deno.env.get("RESEND_API_KEY") || "").trim();
  const from = (Deno.env.get("PREDICTION_EMAIL_FROM") || "").trim();
  return apiKey.startsWith("re_") && from.length >= 5 && from.length <= 320;
}

export async function sendPredictionAccessEmail(
  client: any,
  entry: Row,
  campaign: Row,
  tournament: Row,
  accessCode: string,
) {
  const apiKey = (Deno.env.get("RESEND_API_KEY") || "").trim();
  const from = (Deno.env.get("PREDICTION_EMAIL_FROM") || "").trim();
  const replyTo = (Deno.env.get("PREDICTION_EMAIL_REPLY_TO") || "").trim();
  if (!predictionEmailConfigured()) return { status: "NOT_CONFIGURED" };

  const claim = await client.rpc("claim_tournament_prediction_access_email", { p_entry_id: entry.id });
  if (claim.error) throw claim.error;
  const claimed = Array.isArray(claim.data) ? claim.data[0] : claim.data;
  if (!claimed?.delivery_id) return { status: "ALREADY_SENT" };

  const publicUrl = safeUrl(`https://app.ilhatenis.com/bet?torneio=${encodeURIComponent(String(tournament.slug || ""))}`);
  const name = String(entry.full_name || "Participante").trim();
  const eventName = String(tournament.name || campaign.title || "Ilha Bet").trim();
  const safeName = escapeHtml(name);
  const safeEvent = escapeHtml(eventName);
  const safeCode = escapeHtml(accessCode);
  const safePublicUrl = escapeHtml(publicUrl);
  const subject = `Seu código do Ilha Bet · ${eventName}`.slice(0, 180);
  const html = `<!doctype html><html><body style="margin:0;background:#f1f6f7;color:#102a31;font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden">Guarde seu código para entrar no Ilha Bet em qualquer celular.</div><div style="max-width:560px;margin:0 auto;padding:28px 16px"><div style="background:#092f38;border-radius:20px 20px 0 0;padding:26px;text-align:center"><div style="color:#b8ff00;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">Ilha Tênis</div><h1 style="margin:8px 0 0;color:#fff;font-size:30px">Seu acesso ao Ilha Bet 🎾</h1></div><div style="background:#fff;border-radius:0 0 20px 20px;padding:30px;box-shadow:0 14px 40px rgba(16,42,49,.12)"><p style="margin:0 0 16px;font-size:17px;line-height:1.55">Oi, <strong>${safeName}</strong>!</p><p style="margin:0 0 22px;font-size:16px;line-height:1.55">Seu cartão de palpites do <strong>${safeEvent}</strong> está pronto. Guarde este e-mail: o código abaixo permite recuperar seus palpites em qualquer celular.</p><div style="margin:22px 0;padding:20px;border:2px solid #b8ff00;border-radius:14px;background:#f7ffe3;text-align:center"><div style="color:#55706f;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">Código de acesso</div><div style="margin-top:8px;color:#092f38;font-size:30px;font-weight:900;letter-spacing:.14em">${safeCode}</div></div><p style="margin:0 0 22px;font-size:14px;line-height:1.55;color:#55706f">Ele é pessoal. Não encaminhe este e-mail para outras pessoas.</p><p style="margin:0;text-align:center"><a href="${safePublicUrl}" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#b8ff00;color:#18320b;text-decoration:none;font-weight:900">Abrir o Ilha Bet</a></p><p style="margin:26px 0 0;font-size:12px;line-height:1.5;color:#738689;text-align:center">Participação recreativa e gratuita. Este e-mail foi enviado porque você se cadastrou no Ilha Bet.</p></div></div></body></html>`;
  const plainText = `Oi, ${name}!\n\nSeu cartão de palpites do ${eventName} está pronto.\n\nCódigo de acesso: ${accessCode}\n\nGuarde este e-mail. O código permite recuperar seus palpites em qualquer celular e é pessoal.\n\nAbra o Ilha Bet: ${publicUrl}\n\nParticipação recreativa e gratuita.`;

  let sent = false;
  let providerId = "";
  let errorCode = "provider_error";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `ilha-bet-access/${entry.id}`,
      },
      body: JSON.stringify({
        from,
        to: [entry.email],
        subject,
        html,
        text: plainText,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    const payload = await response.json().catch(() => ({})) as Row;
    sent = response.ok && typeof payload.id === "string";
    providerId = sent ? String(payload.id) : "";
    errorCode = providerErrorCode(payload.name || payload.statusCode || `http_${response.status}`);
  } catch (_error) {
    errorCode = "network_error";
  }

  const completed = await client.rpc("complete_tournament_prediction_access_email", {
    p_delivery_id: claimed.delivery_id,
    p_sent: sent,
    p_provider_message_id: providerId || null,
    p_error_code: sent ? null : errorCode,
  });
  if (completed.error) throw completed.error;
  return { status: sent ? "SENT" : "FAILED", error_code: sent ? null : errorCode };
}

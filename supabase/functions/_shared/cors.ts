const defaultAllowedOrigins = new Set([
  "https://app.ilhatenis.com",
  "https://ilha-app-staging.vercel.app",
  "http://localhost:8769",
  "http://127.0.0.1:8769",
]);

function configuredAllowedOrigins() {
  const origins = new Set(defaultAllowedOrigins);
  const configured = (Deno.env.get("APP_ALLOWED_ORIGINS") || "").trim();
  if (!configured) return origins;

  for (const value of configured.split(",")) {
    const candidate = value.trim();
    if (!candidate || candidate === "*") return null;
    try {
      const url = new URL(candidate);
      const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
      if ((url.protocol !== "https:" && !localHttp) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return null;
      origins.add(url.origin);
    } catch (_error) {
      return null;
    }
  }
  return origins;
}

const allowedOrigins = configuredAllowedOrigins();

export function appCorsHeaders(
  request: Request,
  methods: string,
  allowedHeaders = "authorization, apikey, content-type, x-client-info",
) {
  const origin = request.headers.get("origin") || "";
  const responseOrigin = allowedOrigins?.has(origin)
    ? origin
    : origin
    ? "null"
    : "https://app.ilhatenis.com";
  return {
    "Access-Control-Allow-Origin": responseOrigin,
    "Access-Control-Allow-Headers": allowedHeaders,
    "Access-Control-Allow-Methods": methods,
    "Vary": "Origin",
  };
}

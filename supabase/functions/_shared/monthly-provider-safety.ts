type Data = Record<string, unknown>;

export function monthlyReviewEvent(event: string) {
  return ["PAYMENT_RECEIVED_IN_CASH_UNDONE", "PAYMENT_RESTORED", "PAYMENT_REFUND_DENIED"].includes(event);
}

export function monthlyProviderOperation(path: string, method = "GET") {
  if (path === "/customers" && method === "POST") return "CUSTOMER_CREATE";
  if (path.startsWith("/customers")) return method === "PUT" ? "CUSTOMER_UPDATE" : "CUSTOMER_LOOKUP";
  if (path === "/payments" && method === "POST") return "PAYMENT_CREATE";
  return path.endsWith("/pixQrCode") ? "PIX_READ" : "PAYMENT_LOOKUP";
}

// Provider descriptions can contain customer data. Only this closed list is
// allowed into logs and administrative error messages.
export function monthlyProviderDiagnostic(error: unknown) {
  const outer = error as Data | null;
  const candidate = (outer?.name === "AmbiguousProviderResultError" ? outer.cause : outer) as Data | null;
  if (!candidate || candidate.name !== "AsaasRequestError") return null;
  const status = Number(candidate.status);
  const allowedCodes = new Set(["invalid_object", "invalid_value", "invalid_due_date", "invalid_duedate", "invalid_cpfcnpj", "invalid_email", "invalid_phone", "invalid_customer", "unauthorized", "invalid_access_token", "rate_limit_exceeded"]);
  const allowedOperations = new Set(["CUSTOMER_CREATE", "CUSTOMER_UPDATE", "CUSTOMER_LOOKUP", "PAYMENT_CREATE", "PAYMENT_LOOKUP", "PIX_READ"]);
  return {
    http_status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : 0,
    codes: [...new Set((Array.isArray(candidate.codes) ? candidate.codes : []).map((code) => String(code).toLowerCase()).filter((code) => allowedCodes.has(code)))].slice(0, 5),
    operation: allowedOperations.has(String(candidate.operation)) ? String(candidate.operation) : "UNKNOWN",
  };
}

export function monthlyRemoteDueDateChanged(payment: Data, expectedDueDate: unknown) {
  return String(payment.dueDate || "").slice(0, 10) !== String(expectedDueDate || "").slice(0, 10);
}

export function isDefiniteCustomerRejection(error: unknown) {
  if ((error as Data | null)?.name !== "AsaasRequestError") return false;
  const diagnostic = monthlyProviderDiagnostic(error);
  return diagnostic?.operation === "CUSTOMER_CREATE" && [400, 422].includes(diagnostic.http_status);
}

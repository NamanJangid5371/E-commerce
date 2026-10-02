/** Shared COD / payment method helpers (safe for client + server). */
export function isCodPaymentMethod(method?: string | null) {
  if (!method) return false;
  const value = method.toLowerCase();
  return value.includes("cod") || value.includes("cash on delivery");
}

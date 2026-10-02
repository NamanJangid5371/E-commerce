export const ORIGINS = {
  store: process.env.E2E_STORE_URL ?? "http://localhost:3000",
  admin: process.env.E2E_ADMIN_URL ?? "http://localhost:3001",
  logistics: process.env.E2E_LOGISTICS_URL ?? "http://localhost:3002",
} as const;

export const STAFF = {
  email: process.env.E2E_STAFF_EMAIL ?? "admin@avyora.com",
  /** Must be provided via E2E_STAFF_PASSWORD — no hardcoded demo password in source. */
  password: process.env.E2E_STAFF_PASSWORD ?? "",
} as const;

export const PRODUCT_PATH = "/product/solenne-diamond-solitaire";

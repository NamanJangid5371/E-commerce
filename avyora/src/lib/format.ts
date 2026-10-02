export function formatINR(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Invoice / PDF money — always 2 decimal places, en-IN grouping. */
export function formatInvoiceINR(amount: number) {
  const n = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatINRCompact(amount: number) {
  if (amount >= 10_000_000) {
    const cr = amount / 10_000_000;
    const label = Number.isInteger(cr) ? String(cr) : cr.toFixed(1).replace(/\.0$/, "");
    return `₹${label} Cr`;
  }
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${Math.round(amount / 1000)}k`;
  return formatINR(amount);
}

export function formatCount(n: number) {
  return new Intl.NumberFormat("en-IN").format(n);
}

export function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function deliveryEstimate(days = 5) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

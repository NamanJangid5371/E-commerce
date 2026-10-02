import { describe, expect, it } from "vitest";
import { formatInvoiceINR } from "@/lib/format";

describe("formatInvoiceINR", () => {
  it("formats with two decimal places and INR symbol", () => {
    expect(formatInvoiceINR(1299)).toMatch(/1,299\.00/);
    expect(formatInvoiceINR(0)).toMatch(/0\.00/);
    expect(formatInvoiceINR(12750.5)).toMatch(/12,750\.50/);
  });

  it("handles non-finite values safely", () => {
    expect(formatInvoiceINR(Number.NaN)).toMatch(/0\.00/);
  });
});

import { describe, expect, it } from "vitest";
import { calculateCheckoutTotals, type DiscountInput } from "./discounts";

const baseLine = {
  productId: "p1",
  variantId: "v1",
  quantity: 1,
  unitPrice: 10_000,
};

function baseInput(overrides: Partial<DiscountInput> = {}): DiscountInput {
  return {
    lines: [baseLine],
    shippingCharge: 500,
    freeShippingAbove: 50_000,
    ...overrides,
  };
}

describe("calculateCheckoutTotals", () => {
  it("applies percent coupon", () => {
    const result = calculateCheckoutTotals(
      baseInput({
        coupon: { type: "PERCENT", value: 10, minOrder: 0 },
      }),
    );

    expect(result.subtotal).toBe(10_000);
    expect(result.couponDiscount).toBe(1_000);
    expect(result.groupDiscount).toBe(0);
    expect(result.shipping).toBe(500);
    expect(result.tax).toBe(270);
    expect(result.total).toBe(9_770);
    expect(result.applied).toContain("coupon:PERCENT:10");
  });

  it("applies flat coupon", () => {
    const result = calculateCheckoutTotals(
      baseInput({
        coupon: { type: "FLAT", value: 500, minOrder: 0 },
      }),
    );

    expect(result.couponDiscount).toBe(500);
    expect(result.tax).toBe(285);
    expect(result.total).toBe(10_285);
    expect(result.applied).toContain("coupon:FLAT:500");
  });

  it("applies free shipping coupon", () => {
    const result = calculateCheckoutTotals(
      baseInput({
        coupon: { type: "FREE_SHIPPING", value: 0, minOrder: 0 },
      }),
    );

    expect(result.couponDiscount).toBe(0);
    expect(result.shipping).toBe(0);
    expect(result.tax).toBe(300);
    expect(result.total).toBe(10_300);
    expect(result.applied).toContain("coupon:FREE_SHIPPING");
  });

  it("applies group discount percent", () => {
    const result = calculateCheckoutTotals(
      baseInput({
        groupDiscountPercent: 5,
      }),
    );

    expect(result.groupDiscount).toBe(500);
    expect(result.tax).toBe(285);
    expect(result.total).toBe(10_285);
    expect(result.applied).toContain("group:5%");
  });

  it("non-stackable rule with higher priority wins", () => {
    const result = calculateCheckoutTotals(
      baseInput({
        groupRules: [
          {
            type: "PERCENT",
            value: 10,
            stackable: false,
            priority: 1,
          },
          {
            type: "PERCENT",
            value: 20,
            stackable: false,
            priority: 2,
          },
        ],
      }),
    );

    expect(result.groupDiscount).toBe(2_000);
    expect(result.applied).toContain("group-rule:PERCENT:2");
    expect(result.applied).not.toContain("group-rule:PERCENT:1");
  });

  it("respects max discount cap on coupon", () => {
    const result = calculateCheckoutTotals(
      baseInput({
        coupon: {
          type: "PERCENT",
          value: 50,
          minOrder: 0,
          maxDiscount: 1_000,
        },
      }),
    );

    expect(result.couponDiscount).toBe(1_000);
    expect(result.tax).toBe(270);
    expect(result.total).toBe(9_770);
  });

  it("calculates tax at 3%", () => {
    const result = calculateCheckoutTotals(baseInput());

    const taxable = result.subtotal - result.couponDiscount - result.groupDiscount;
    expect(result.tax).toBe(Math.round(taxable * 0.03));
    expect(result.tax).toBe(300);
  });
});

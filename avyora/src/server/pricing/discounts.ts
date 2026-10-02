export type PricingLine = {
  productId: string;
  variantId: string;
  quantity: number;
  unitPrice: number;
  categoryId?: string;
  collectionId?: string;
};

export type GroupRule = {
  type: "PERCENT" | "FLAT";
  value: number;
  maxDiscount?: number;
  productId?: string;
  categoryId?: string;
  collectionId?: string;
  stackable: boolean;
  priority: number;
};

export type DiscountInput = {
  lines: PricingLine[];
  coupon?: {
    type: "PERCENT" | "FLAT" | "FREE_SHIPPING";
    value: number;
    minOrder: number;
    maxDiscount?: number;
  };
  groupDiscountPercent?: number;
  groupRules?: GroupRule[];
  shippingCharge: number;
  freeShippingAbove: number;
};

export type CheckoutTotals = {
  subtotal: number;
  couponDiscount: number;
  groupDiscount: number;
  shipping: number;
  tax: number;
  total: number;
  applied: string[];
};

const TAX_RATE = 0.03;

function roundMoney(amount: number): number {
  return Math.round(amount);
}

function lineSubtotal(line: PricingLine): number {
  return line.quantity * line.unitPrice;
}

function linesSubtotal(lines: PricingLine[]): number {
  return lines.reduce((sum, line) => sum + lineSubtotal(line), 0);
}

function matchingLines(rule: GroupRule, lines: PricingLine[]): PricingLine[] {
  if (!rule.productId && !rule.categoryId && !rule.collectionId) {
    return lines;
  }

  return lines.filter((line) => {
    if (rule.productId && line.productId === rule.productId) return true;
    if (rule.categoryId && line.categoryId === rule.categoryId) return true;
    if (rule.collectionId && line.collectionId === rule.collectionId) return true;
    return false;
  });
}

function ruleMatches(rule: GroupRule, lines: PricingLine[]): boolean {
  return matchingLines(rule, lines).length > 0;
}

function applyPercentDiscount(
  base: number,
  percent: number,
  maxDiscount?: number,
): number {
  let discount = roundMoney(base * (percent / 100));
  if (maxDiscount !== undefined) {
    discount = Math.min(discount, maxDiscount);
  }
  return Math.max(0, Math.min(discount, base));
}

function applyFlatDiscount(base: number, value: number, maxDiscount?: number): number {
  let discount = value;
  if (maxDiscount !== undefined) {
    discount = Math.min(discount, maxDiscount);
  }
  return Math.max(0, Math.min(roundMoney(discount), base));
}

function calculateRuleDiscount(rule: GroupRule, lines: PricingLine[]): number {
  const base = linesSubtotal(matchingLines(rule, lines));
  if (base <= 0) {
    return 0;
  }

  if (rule.type === "PERCENT") {
    return applyPercentDiscount(base, rule.value, rule.maxDiscount);
  }

  return applyFlatDiscount(base, rule.value, rule.maxDiscount);
}

function calculateCouponDiscount(
  coupon: DiscountInput["coupon"],
  subtotal: number,
): { discount: number; freeShipping: boolean; label: string | null } {
  if (!coupon || subtotal < coupon.minOrder) {
    return { discount: 0, freeShipping: false, label: null };
  }

  if (coupon.type === "FREE_SHIPPING") {
    return { discount: 0, freeShipping: true, label: "coupon:FREE_SHIPPING" };
  }

  if (coupon.type === "PERCENT") {
    const discount = applyPercentDiscount(subtotal, coupon.value, coupon.maxDiscount);
    return {
      discount,
      freeShipping: false,
      label: discount > 0 ? `coupon:PERCENT:${coupon.value}` : null,
    };
  }

  const discount = applyFlatDiscount(subtotal, coupon.value, coupon.maxDiscount);
  return {
    discount,
    freeShipping: false,
    label: discount > 0 ? `coupon:FLAT:${coupon.value}` : null,
  };
}

function calculateGroupDiscount(
  input: DiscountInput,
  subtotal: number,
  remainingAfterCoupon: number,
): { discount: number; labels: string[] } {
  const rules = input.groupRules ?? [];
  const matchingRules = rules.filter((rule) => ruleMatches(rule, input.lines));
  const applied: string[] = [];
  let discount = 0;

  const nonStackableMatches = matchingRules.filter((rule) => !rule.stackable);

  if (nonStackableMatches.length > 0) {
    const best = nonStackableMatches.reduce((current, candidate) =>
      candidate.priority > current.priority ? candidate : current,
    );
    discount = calculateRuleDiscount(best, input.lines);
    if (discount > 0) {
      applied.push(`group-rule:${best.type}:${best.priority}`);
    }
    return { discount, labels: applied };
  }

  const stackableMatches = matchingRules.filter((rule) => rule.stackable);
  if (stackableMatches.length > 0) {
    for (const rule of stackableMatches.sort((a, b) => b.priority - a.priority)) {
      const ruleDiscount = calculateRuleDiscount(rule, input.lines);
      if (ruleDiscount <= 0) {
        continue;
      }
      discount += ruleDiscount;
      applied.push(`group-rule:${rule.type}:${rule.priority}`);
    }

    discount = Math.min(discount, remainingAfterCoupon);
    return { discount, labels: applied };
  }

  if (input.groupDiscountPercent && input.groupDiscountPercent > 0) {
    discount = applyPercentDiscount(remainingAfterCoupon, input.groupDiscountPercent);
    if (discount > 0) {
      applied.push(`group:${input.groupDiscountPercent}%`);
    }
  }

  return { discount, labels: applied };
}

function calculateShipping(
  input: DiscountInput,
  subtotal: number,
  couponDiscount: number,
  groupDiscount: number,
  freeShippingCoupon: boolean,
): number {
  if (freeShippingCoupon) {
    return 0;
  }

  const merchandiseTotal = subtotal - couponDiscount - groupDiscount;
  if (merchandiseTotal <= 0) {
    return 0;
  }

  if (merchandiseTotal >= input.freeShippingAbove) {
    return 0;
  }

  return Math.max(0, roundMoney(input.shippingCharge));
}

export function calculateCheckoutTotals(input: DiscountInput): CheckoutTotals {
  const subtotal = linesSubtotal(input.lines);
  const applied: string[] = [];

  const couponResult = calculateCouponDiscount(input.coupon, subtotal);
  let couponDiscount = couponResult.discount;
  if (couponResult.label) {
    applied.push(couponResult.label);
  }

  const remainingAfterCoupon = Math.max(0, subtotal - couponDiscount);
  const groupResult = calculateGroupDiscount(input, subtotal, remainingAfterCoupon);
  let groupDiscount = groupResult.discount;
  applied.push(...groupResult.labels);

  const maxDiscount = subtotal;
  const totalDiscount = couponDiscount + groupDiscount;
  if (totalDiscount > maxDiscount) {
    const overflow = totalDiscount - maxDiscount;
    if (groupDiscount >= overflow) {
      groupDiscount -= overflow;
    } else {
      const groupUsed = groupDiscount;
      groupDiscount = 0;
      couponDiscount = Math.max(0, couponDiscount - (overflow - groupUsed));
    }
  }

  const taxable = Math.max(0, subtotal - couponDiscount - groupDiscount);
  const shipping = calculateShipping(
    input,
    subtotal,
    couponDiscount,
    groupDiscount,
    couponResult.freeShipping,
  );
  const tax = roundMoney(taxable * TAX_RATE);
  const total = Math.max(0, taxable + shipping + tax);

  return {
    subtotal,
    couponDiscount,
    groupDiscount,
    shipping,
    tax,
    total,
    applied,
  };
}

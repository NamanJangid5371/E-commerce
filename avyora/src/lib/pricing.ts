import type { Coupon, Product } from "@/data/types";

export function couponAppliesToProduct(coupon: Coupon, product: Product) {
  if (coupon.active === false) return false;
  const restricted = coupon.productSlugs?.length || coupon.categoryNames?.length;
  if (!restricted) return true;
  if (coupon.productSlugs?.includes(product.slug)) return true;
  if (coupon.categoryNames?.includes(product.category)) return true;
  return false;
}

export function couponEligible(coupon: Coupon, subtotal: number) {
  if (coupon.active === false) return false;
  if (subtotal < coupon.minOrder) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (coupon.startsAt && today < coupon.startsAt) return false;
  if (coupon.endsAt && today > coupon.endsAt) return false;
  if (coupon.usageLimit && (coupon.usageCount ?? 0) >= coupon.usageLimit) return false;
  return true;
}

export function couponDiscountAmount(coupon: Coupon, subtotal: number) {
  if (coupon.type === "free_shipping") return 0;
  if (coupon.type === "percent") {
    let discount = Math.round(subtotal * (coupon.value / 100));
    if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
    return discount;
  }
  return coupon.value;
}

export function priceAfterCoupon(coupon: Coupon, unitPrice: number) {
  if (coupon.type === "free_shipping") return unitPrice;
  return Math.max(0, unitPrice - couponDiscountAmount(coupon, unitPrice));
}

export function variantUnitPrice(variant: { price: number; salePrice?: number }) {
  return variant.salePrice ?? variant.price;
}

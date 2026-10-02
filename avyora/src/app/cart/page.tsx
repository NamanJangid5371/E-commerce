"use client";

import { PersonalizedRecommendations } from "@/components/personalized-recommendations";
import { formatINR } from "@/lib/format";
import { trackEvent } from "@/lib/track-event";
import { useCartTotals, useShopStore } from "@/store/shop-store";
import { ProductImage } from "@/components/product-image";
import Link from "next/link";
import { useState } from "react";

const steps = ["Bag", "Delivery", "Payment"] as const;

export default function CartPage() {
  const cart = useShopStore((s) => s.cart);
  const catalog = useShopStore((s) => s.catalog);
  const updateQty = useShopStore((s) => s.updateQty);
  const removeFromCart = useShopStore((s) => s.removeFromCart);
  const applyCoupon = useShopStore((s) => s.applyCoupon);
  const couponCode = useShopStore((s) => s.couponCode);
  const totals = useCartTotals();
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");

  if (!cart.length) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-14 text-center md:py-16">
        <p className="section-kicker">Bag</p>
        <h1 className="section-title">Your bag is empty</h1>
        <p className="prose-calm mx-auto mt-4 max-w-xl text-center">
          Begin with a collection, or return to a piece you loved.
        </p>
        <Link href="/shop" className="btn-primary mt-8 inline-flex">
          Continue shopping
        </Link>
        <PersonalizedRecommendations
          context="CART"
          kicker="Still browsing"
          title="You may also need"
          className="mx-auto mt-12 max-w-7xl text-left"
          limit={4}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-14">
      <div className="mb-10 flex flex-wrap items-center gap-3 text-[11px] tracking-[0.18em] uppercase">
        {steps.map((step, i) => (
          <span key={step} className="flex items-center gap-3">
            <span className={i === 0 ? "text-ink" : "text-ink-soft"}>{step}</span>
            {i < steps.length - 1 && <span className="h-px w-8 bg-line" />}
          </span>
        ))}
      </div>

      <div className="grid gap-12 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Your bag</h1>
          <div className="mt-10 space-y-8">
            {cart.map((item) => {
              const product = catalog.find((p) => p.id === item.productId);
              const variant = product?.variants.find((v) => v.sku === item.sku);
              if (!product || !variant) return null;
              const price = variant.salePrice ?? variant.price;
              return (
                <div key={item.sku} className="flex gap-5 border-b border-line pb-8">
                  <div className="relative h-36 w-28 shrink-0 overflow-hidden bg-ivory ring-1 ring-[rgba(138,109,69,0.18)]">
                    <ProductImage src={product.images[0]} alt={product.name} fill />
                  </div>
                  <div className="flex flex-1 flex-col">
                    <div className="flex justify-between gap-4">
                      <div>
                        <Link href={`/product/${product.slug}`} className="text-lg font-medium tracking-tight">
                          {product.name}
                        </Link>
                        <p className="mt-1 text-sm text-ink-soft">
                          {variant.colour} {variant.purity} {variant.size ? `· Size ${variant.size}` : ""}
                        </p>
                      </div>
                      <p className="price-amount text-xl">{formatINR(price * item.quantity)}</p>
                    </div>
                    <div className="mt-auto flex items-center justify-between pt-4">
                      <div className="flex border border-line">
                        <button className="px-3 py-1.5 transition hover:bg-ivory" onClick={() => updateQty(item.sku, item.quantity - 1)}>
                          −
                        </button>
                        <span className="px-3 py-1.5">{item.quantity}</span>
                        <button className="px-3 py-1.5 transition hover:bg-ivory" onClick={() => updateQty(item.sku, item.quantity + 1)}>
                          +
                        </button>
                      </div>
                      <button
                        onClick={() => {
                          removeFromCart(item.sku);
                          trackEvent({
                            eventType: "REMOVE_FROM_CART",
                            productId: product.id,
                            categoryId: product.categoryId,
                          });
                        }}
                        className="text-xs uppercase tracking-widest text-ink-soft transition hover:text-ink"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="shadow-soft h-fit border border-line bg-ivory/80 p-8">
          <h2 className="text-lg font-bold">Order summary</h2>
          <div className="gold-line mt-5" />
          <div className="mt-6 space-y-3 text-sm">
            <p className="flex justify-between">
              <span className="text-ink-soft">Subtotal</span>
              <span>{formatINR(totals.subtotal)}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-ink-soft">Discount</span>
              <span>{totals.discount ? `−${formatINR(totals.discount)}` : "—"}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-ink-soft">Shipping</span>
              <span>{totals.shipping ? formatINR(totals.shipping) : "Complimentary"}</span>
            </p>
            <p className="flex justify-between border-t border-line pt-4 text-base font-medium">
              <span>Total</span>
              <span className="price-amount text-2xl">{formatINR(totals.total)}</span>
            </p>
          </div>
          <div className="mt-6 flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Coupon"
              className="flex-1 border border-line bg-transparent px-3 py-2 text-sm"
            />
            <button
              onClick={() => setMsg(applyCoupon(code))}
              className="border border-ink px-4 text-[11px] tracking-widest uppercase transition hover:bg-ink hover:text-ivory"
            >
              Apply
            </button>
          </div>
          {couponCode && <p className="mt-2 text-xs">Using {couponCode}</p>}
          {msg && <p className="mt-2 text-xs text-ink-soft">{msg}</p>}
          <p className="mt-3 text-[11px] text-ink-soft">Try AVYORA10, FESTIVE15 or WELCOME500</p>
          <Link href="/checkout" className="btn-primary mt-8 block w-full text-center">
            Checkout
          </Link>
        </aside>
      </div>

      <PersonalizedRecommendations
        context="CART"
        kicker="Complete the look"
        title="You may also need"
        className="mt-14 pb-2"
        limit={8}
      />
    </div>
  );
}

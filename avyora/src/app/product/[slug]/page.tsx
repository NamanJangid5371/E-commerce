"use client";

import { ProductCard } from "@/components/product-card";
import { PersonalizedRecommendations } from "@/components/personalized-recommendations";
import { SizeGuideModal } from "@/components/size-guide-modal";
import { useToast } from "@/components/toast";
import { ProductImage } from "@/components/product-image";
import { ProductViewer, productHasSpin } from "@/components/product-viewer";
import { deliveryEstimate, formatINR } from "@/lib/format";
import { fetchJson, isApiOffline } from "@/lib/api-client";
import { trackEvent } from "@/lib/track-event";
import { useLiveCatalog, useShopStore } from "@/store/shop-store";
import { Calendar, Heart, MessageCircle, Ruler, Shield, Truck } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

function whatsappDigits(raw?: string) {
  return (raw || "").replace(/\D/g, "");
}

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { products, ops } = useLiveCatalog();
  const product = products.find((p) => p.slug === slug);
  const addToCart = useShopStore((s) => s.addToCart);
  const buyNow = useShopStore((s) => s.buyNow);
  const toggleWishlist = useShopStore((s) => s.toggleWishlist);
  const toggleRestockAlert = useShopStore((s) => s.toggleRestockAlert);
  const user = useShopStore((s) => s.user);
  const customers = useShopStore((s) => s.customers);
  const setPreferredRingSize = useShopStore((s) => s.setPreferredRingSize);
  const wished = useShopStore((s) => (product ? s.wishlist.includes(product.id) : false));
  const { toast } = useToast();
  const [sku, setSku] = useState(product?.variants[0]?.sku ?? "");
  const [qty, setQty] = useState(1);
  const [tab, setTab] = useState<"story" | "specs" | "care" | "reviews">("story");
  const [added, setAdded] = useState(false);
  const [pop, setPop] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewBody, setReviewBody] = useState("");
  const [reviewMsg, setReviewMsg] = useState<string | null>(null);
  const [reviewErr, setReviewErr] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewOffline, setReviewOffline] = useState(false);

  const customer = useMemo(
    () =>
      user?.role === "customer"
        ? customers.find((c) => c.email.toLowerCase() === user.email.toLowerCase())
        : undefined,
    [customers, user],
  );
  const restockOn = Boolean(product && customer?.restockAlerts?.includes(product.id));

  useEffect(() => {
    if (product && !product.variants.some((v) => v.sku === sku)) {
      setSku(product.variants[0]?.sku ?? "");
    }
  }, [product, sku]);

  useEffect(() => {
    if (!product) return;
    trackEvent({
      eventType: "PRODUCT_VIEW",
      productId: product.id,
      categoryId: product.categoryId,
    });
  }, [product?.id]);

  useEffect(() => {
    if (!product?.variants.some((v) => v.size) || !customer?.preferredRingSize) return;
    const match = product.variants.find((v) => v.size === customer.preferredRingSize);
    if (match) setSku(match.sku);
  }, [product, customer?.preferredRingSize]);

  const variant = useMemo(() => product?.variants.find((v) => v.sku === sku), [product, sku]);

  if (!product) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="font-serif text-4xl">This piece is no longer listed</h1>
        <Link href="/shop" className="btn-primary mt-8 inline-flex">
          Return to shop
        </Link>
      </div>
    );
  }

  const price = variant ? variant.salePrice ?? variant.price : 0;
  const together = products.filter((p) => product.togetherSlugs?.includes(p.slug));

  const wa = whatsappDigits(ops?.settings.whatsapp || ops?.settings.phone);
  const waHref = wa
    ? `https://wa.me/${wa}?text=${encodeURIComponent(`Hi Avyora, I’d like to ask about ${product.name} (${variant?.sku ?? product.slug}).`)}`
    : null;

  function onAdd() {
    addToCart(product!.id, sku, qty);
    trackEvent({
      eventType: "ADD_TO_CART",
      productId: product!.id,
      categoryId: product!.categoryId,
    });
    setAdded(true);
    toast("Added to bag");
    setTimeout(() => setAdded(false), 1800);
  }

  function onBuyNow() {
    const ok = buyNow(product!.id, sku, qty);
    if (!ok) {
      toast("This piece is unavailable");
      return;
    }
    router.push("/checkout");
  }

  function onWish() {
    toggleWishlist(product!.id);
    trackEvent({
      eventType: wished ? "WISHLIST_REMOVE" : "WISHLIST_ADD",
      productId: product!.id,
      categoryId: product!.categoryId,
    });
    setPop(true);
    toast(wished ? "Removed from wishlist" : "Saved to wishlist");
    setTimeout(() => setPop(false), 350);
  }

  function onSelectSize(nextSku: string, size?: string) {
    setSku(nextSku);
    if (size && user?.role === "customer") setPreferredRingSize(size);
  }

  async function onSubmitReview(e: FormEvent) {
    e.preventDefault();
    if (reviewBusy || !slug) return;
    setReviewMsg(null);
    setReviewErr(null);
    setReviewOffline(false);
    setReviewBusy(true);

    const res = await fetchJson<{ message?: string }>(`/api/products/${slug}/reviews`, {
      method: "POST",
      body: JSON.stringify({
        rating: reviewRating,
        title: reviewTitle.trim(),
        body: reviewBody.trim(),
      }),
    });

    setReviewBusy(false);

    if (isApiOffline(res)) {
      setReviewOffline(true);
      setReviewErr("Reviews sync when the database is online. Your seed reviews above remain visible.");
      return;
    }

    if (!res.ok) {
      setReviewErr(res.error);
      return;
    }

    setReviewMsg(res.data?.message ?? "Review submitted and pending moderation.");
    setReviewTitle("");
    setReviewBody("");
    setReviewRating(5);
    toast("Review submitted");
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 pb-28 lg:pb-12">
      <SizeGuideModal open={sizeOpen} onClose={() => setSizeOpen(false)} />
      <p className="text-[11px] tracking-[0.18em] uppercase text-ink-soft">
        Shop / {product.category} / {product.name}
      </p>
      <div className="mt-8 grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
        <div>
          <ProductViewer
            key={product.id}
            images={product.images}
            alt={product.name}
            enableSpin={productHasSpin(product)}
          />
        </div>

        <div className="lg:sticky lg:top-24">
          <p className="text-sm font-semibold text-gold-deep">{product.collection}</p>
          <h1 className="mt-1 text-2xl font-extrabold leading-snug tracking-tight md:text-3xl">{product.name}</h1>
          <p className="mt-2 text-sm text-ink-soft">
            {product.rating} ★ · {product.reviewCount} reviews · SKU {variant?.sku}
          </p>
          <p className="price-amount mt-4 text-2xl">
            {formatINR(price)}
            {variant?.salePrice && (
              <span className="ml-2 text-lg font-normal text-ink-soft line-through">{formatINR(variant.price)}</span>
            )}
          </p>
          <p className="mt-1 text-xs text-ink-soft">{product.taxNote}</p>

          <div className="mt-5 rounded-xl border border-line bg-ivory px-4 py-3 text-sm">
            <p className="flex items-center gap-2 font-semibold text-ink">
              <Shield size={14} className="text-gold-deep" /> Certificate included
            </p>
            <p className="mt-1 text-ink-soft">
              {product.certifiedBy} · {product.certificateNumber || "Hallmark on request"}
            </p>
            <p className="mt-1 text-xs text-ink-soft">
              BIS hallmarked · {(ops?.settings.returnDays ?? 15)}-day exchange · Insured shipping
            </p>
          </div>

          <p className="prose-calm mt-6">{product.description}</p>

          {product.variants.some((v) => v.size) && (
            <div className="mt-9">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] tracking-[0.18em] uppercase">Size</p>
                <button
                  type="button"
                  onClick={() => setSizeOpen(true)}
                  className="inline-flex items-center gap-1.5 text-[11px] tracking-widest uppercase text-ink-soft underline"
                >
                  <Ruler size={12} /> Size guide
                </button>
              </div>
              {customer?.preferredRingSize && (
                <p className="mt-2 text-xs text-ink-soft">Saved size: {customer.preferredRingSize}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {product.variants.map((v) => (
                  <button
                    key={v.sku}
                    onClick={() => onSelectSize(v.sku, v.size)}
                    className={`min-w-12 border px-3 py-2 text-sm transition ${
                      sku === v.sku ? "border-ink bg-ink text-ivory" : "border-line hover:border-ink"
                    }`}
                  >
                    {v.size ?? v.colour}
                  </button>
                ))}
              </div>
            </div>
          )}

          {product.variants.some((v) => !v.size) && product.variants.length > 1 && (
            <div className="mt-9">
              <p className="text-[11px] tracking-[0.18em] uppercase">Finish</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {product.variants.map((v) => (
                  <button
                    key={v.sku}
                    onClick={() => setSku(v.sku)}
                    className={`border px-3 py-2 text-sm transition ${
                      sku === v.sku ? "border-ink bg-ink text-ivory" : "border-line hover:border-ink"
                    }`}
                  >
                    {v.colour} {v.purity} {v.metal}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-9 flex items-center gap-3">
            <div className="flex border border-line">
              <button className="px-3 py-3 transition hover:bg-ivory" onClick={() => setQty((q) => Math.max(1, q - 1))}>
                −
              </button>
              <span className="px-4 py-3">{qty}</span>
              <button className="px-3 py-3 transition hover:bg-ivory" onClick={() => setQty((q) => q + 1)}>
                +
              </button>
            </div>
            <button onClick={onAdd} disabled={!variant || variant.stock < 1} className="btn-primary flex-1 py-3.5">
              {variant && variant.stock < 1 ? "Waitlist" : added ? "Added to bag" : "Add to bag"}
            </button>
            <button
              onClick={onWish}
              className={`border border-line p-3.5 transition hover:border-ink ${pop ? "heart-pop" : ""}`}
              aria-label="Wishlist"
            >
              <Heart size={18} fill={wished ? "currentColor" : "none"} />
            </button>
          </div>
          <button
            type="button"
            onClick={onBuyNow}
            disabled={!variant || variant.stock < 1}
            className="mt-3 w-full border border-ink px-4 py-3.5 text-[11px] tracking-[0.18em] uppercase transition hover:bg-ink hover:text-ivory disabled:opacity-40"
          >
            Buy now
          </button>
          {variant && variant.stock < 1 && user?.role === "customer" && (
            <button
              type="button"
              onClick={() => {
                toggleRestockAlert(product.id);
                toast(restockOn ? "Restock alert removed" : "We’ll alert you when it’s back");
              }}
              className="mt-3 w-full text-center text-xs underline text-ink-soft"
            >
              {restockOn ? "Cancel restock alert" : "Notify me when back in stock"}
            </button>
          )}
          <p className="mt-3 text-xs text-ink-soft">
            {variant?.stock ?? 0} in atelier · Estimated delivery {deliveryEstimate()}
          </p>
          {waHref && (
            <a
              href={waHref}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-2 text-sm text-ink-soft underline underline-offset-2"
            >
              <MessageCircle size={16} /> Ask about this piece on WhatsApp
            </a>
          )}
          <Link
            href={`/visit?piece=${product.slug}`}
            className="mt-3 inline-flex items-center gap-2 text-sm text-ink-soft underline underline-offset-2"
          >
            <Calendar size={16} /> View this piece at Walton Road
          </Link>
          <div className="mt-8 grid gap-4 border-t border-line pt-8 text-sm text-ink-soft">
            <p className="flex items-center gap-3">
              <Shield size={16} className="text-gold-deep" /> {product.certifiedBy} · {product.certificateNumber}
            </p>
            <p className="flex items-center gap-3">
              <Truck size={16} className="text-gold-deep" /> Insured shipping · {product.warranty}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-20 border-t border-line pt-12">
        <div className="flex flex-wrap gap-2">
          {(["story", "specs", "care", "reviews"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`border px-4 py-2.5 text-[11px] tracking-[0.16em] uppercase transition ${
                tab === t
                  ? "border-ink bg-ink text-ivory"
                  : "border-line bg-paper text-ink hover:border-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="mt-8 max-w-3xl text-sm leading-8 text-ink-soft">
          {tab === "story" && <p className="text-ink">{product.story}</p>}
          {tab === "specs" && (
            <dl className="grid grid-cols-2 gap-5">
              {[
                ["Metal", `${product.purity} ${product.colour} ${product.metal}`],
                ["Stone", product.stone ?? "—"],
                ["Cut", product.cut ?? "—"],
                ["Clarity", product.clarity ?? "—"],
                ["Carat", product.carat ?? "—"],
                ["Weight", product.weight],
                ["Dimensions", product.dimensions],
                ["Making", formatINR(product.makingCharge)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] tracking-[0.16em] uppercase text-gold-deep">{k}</dt>
                  <dd className="mt-1 text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {tab === "care" && (
            <div className="space-y-4 text-ink">
              <p>{product.care}</p>
              <p>{product.returnPolicy}</p>
            </div>
          )}
          {tab === "reviews" && (
            <div className="space-y-6">
              {product.reviews.map((r) => (
                <div key={r.id} className="border-b border-line pb-6">
                  <p className="font-medium text-ink">
                    {r.title} · {r.rating}/5
                  </p>
                  <p className="text-xs">
                    {r.author} {r.verified && "· Verified"} · {r.date}
                  </p>
                  <p className="mt-2 text-ink">{r.body}</p>
                </div>
              ))}

              {user?.role === "customer" ? (
                <form onSubmit={onSubmitReview} className="mt-8 border border-line bg-ivory/50 p-5">
                  <p className="text-[11px] tracking-[0.16em] uppercase text-gold-deep">Write a review</p>
                  <label className="mt-4 block text-sm">
                    Rating
                    <select
                      value={reviewRating}
                      onChange={(e) => setReviewRating(Number(e.target.value))}
                      className="mt-1 w-full border border-line bg-transparent px-3 py-2"
                    >
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>
                          {n} / 5
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    required
                    value={reviewTitle}
                    onChange={(e) => setReviewTitle(e.target.value)}
                    placeholder="Review title"
                    maxLength={120}
                    className="mt-3 w-full border border-line bg-transparent px-3 py-2 text-sm"
                  />
                  <textarea
                    required
                    value={reviewBody}
                    onChange={(e) => setReviewBody(e.target.value)}
                    placeholder="Share your experience with this piece"
                    maxLength={5000}
                    className="mt-3 min-h-24 w-full border border-line bg-transparent px-3 py-2 text-sm"
                  />
                  {reviewErr && (
                    <p className={`mt-3 text-sm ${reviewOffline ? "text-ink-soft" : "text-red-800"}`}>{reviewErr}</p>
                  )}
                  {reviewMsg && <p className="mt-3 text-sm text-ink-soft">{reviewMsg}</p>}
                  <button type="submit" disabled={reviewBusy} className="btn-primary mt-4 disabled:opacity-50">
                    {reviewBusy ? "Submitting…" : "Submit review"}
                  </button>
                </form>
              ) : (
                <p className="mt-6 text-sm text-ink-soft">
                  <Link href={`/login?next=/product/${slug}`} className="underline">
                    Sign in
                  </Link>{" "}
                  to write a review.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="relative mt-20 h-[62vh] overflow-hidden">
        <ProductImage src={product.lifestyleImage ?? product.images[0]} alt="" fill className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-espresso/30 to-transparent" />
      </div>

      {together.length > 0 && (
        <section className="mt-20">
          <h2 className="section-title mt-0">Frequently bought together</h2>
          <div className="mt-8 grid grid-cols-2 items-stretch gap-x-4 gap-y-8 sm:gap-x-5 md:grid-cols-4">
            {together.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur-md lg:hidden">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{formatINR(price)}</p>
            <p className="truncate text-[11px] text-ink-soft">{variant?.size ?? variant?.colour ?? product.name}</p>
          </div>
          <button
            type="button"
            onClick={onAdd}
            disabled={!variant || variant.stock < 1}
            className="btn-primary min-h-11 flex-1 py-3"
          >
            {variant && variant.stock < 1 ? "Waitlist" : added ? "Added" : "Add to bag"}
          </button>
        </div>
      </div>

      <section className="mt-24 pb-8">
        <PersonalizedRecommendations
          context="PRODUCT_PAGE"
          title="Similar products"
          productId={product.id}
          limit={8}
        />
      </section>
    </div>
  );
}

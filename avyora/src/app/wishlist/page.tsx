"use client";

import { PersonalizedRecommendations } from "@/components/personalized-recommendations";
import { displayPrice } from "@/data/catalog";
import { ProductImage } from "@/components/product-image";
import { useToast } from "@/components/toast";
import { formatINR } from "@/lib/format";
import { trackEvent } from "@/lib/track-event";
import { useLiveCatalog, useShopStore } from "@/store/shop-store";
import Link from "next/link";

export default function WishlistPage() {
  const ids = useShopStore((s) => s.wishlist);
  const user = useShopStore((s) => s.user);
  const toggleWishlist = useShopStore((s) => s.toggleWishlist);
  const addToCart = useShopStore((s) => s.addToCart);
  const { products } = useLiveCatalog();
  const { toast } = useToast();

  const list = ids.map((id) => ({ id, product: products.find((p) => p.id === id) }));

  return (
    <div className="mx-auto max-w-7xl px-4 py-16">
      <h1 className="text-4xl font-medium tracking-tight">Wishlist</h1>
      <p className="mt-3 max-w-xl text-sm text-ink-soft">
        Saved pieces stay in this browser. Sign in to manage them from your account dashboard.
      </p>

      {!user && (
        <p className="mt-6 text-sm">
          <Link href="/login?next=/wishlist" className="underline">
            Sign in
          </Link>{" "}
          to sync your account, or{" "}
          <Link href="/login?next=/wishlist&mode=up" className="underline">
            create an account
          </Link>
          .
        </p>
      )}

      {list.length ? (
        <ul className="mt-8 grid grid-cols-2 items-stretch gap-x-4 gap-y-8 sm:gap-x-5 lg:grid-cols-3">
          {list.map(({ id, product }) => {
            if (!product) {
              return (
                <li key={id} className="border border-line p-6">
                  <p className="text-sm text-ink-soft">This piece is no longer available.</p>
                  <button
                    type="button"
                    onClick={() => {
                      toggleWishlist(id);
                      trackEvent({ eventType: "WISHLIST_REMOVE", productId: id });
                    }}
                    className="mt-4 text-[11px] tracking-widest uppercase underline"
                  >
                    Remove
                  </button>
                </li>
              );
            }
            const price = displayPrice(product);
            const variant = product.variants.find((v) => v.stock > 0) ?? product.variants[0];
            const available = !!variant && variant.stock > 0;
            return (
              <li key={id} className="border border-line bg-paper/40">
                <Link href={`/product/${product.slug}`} className="relative block aspect-[4/5] overflow-hidden bg-ivory">
                  <ProductImage src={product.images[0]} alt={product.name} fill className="object-cover" sizes="(max-width:768px) 50vw, 33vw" />
                </Link>
                <div className="space-y-2 p-5">
                  <Link href={`/product/${product.slug}`} className="block font-medium hover:text-gold-deep">
                    {product.name}
                  </Link>
                  <p className="text-sm text-ink-soft">
                    {formatINR(price.from)}
                    {!available && <span className="ml-2 text-red-800">Unavailable</span>}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {available && (
                      <button
                        type="button"
                        onClick={() => {
                          addToCart(product.id, variant.sku, 1);
                          trackEvent({
                            eventType: "ADD_TO_CART",
                            productId: product.id,
                            categoryId: product.categoryId,
                          });
                          toast("Moved to bag");
                        }}
                        className="btn-primary py-2"
                      >
                        Move to bag
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        toggleWishlist(id);
                        trackEvent({
                          eventType: "WISHLIST_REMOVE",
                          productId: product.id,
                          categoryId: product.categoryId,
                        });
                        toast("Removed from wishlist");
                      }}
                      className="border border-line px-3 py-2 text-[10px] tracking-widest uppercase"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-10 max-w-lg">
          <p className="text-ink-soft">Save pieces while you decide.</p>
          <Link href="/shop" className="mt-6 inline-block text-[11px] tracking-[0.2em] uppercase underline">
            Browse jewellery
          </Link>
        </div>
      )}

      <PersonalizedRecommendations
        context="WISHLIST"
        kicker="More like your saves"
        title="Similar to your wishlist"
        className="mt-20"
        limit={8}
      />
    </div>
  );
}

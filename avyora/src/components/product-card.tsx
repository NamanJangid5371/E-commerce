"use client";

import { displayPrice, variantStock } from "@/data/catalog";
import type { Product } from "@/data/types";
import { cn } from "@/lib/cn";
import { formatINR } from "@/lib/format";
import { useShopStore } from "@/store/shop-store";
import { Heart } from "lucide-react";
import { ProductImage } from "@/components/product-image";
import { useToast } from "@/components/toast";
import { trackEvent } from "@/lib/track-event";
import Link from "next/link";
import { useMemo, useState, type MouseEvent } from "react";

function productSpecPills(product: Product): string[] {
  const pills: string[] = [];
  if (product.purity) pills.push(product.purity);
  if (product.metal) pills.push(product.metal);
  if (product.stone) pills.push(product.stone);
  if (product.certifiedBy && pills.length < 3) pills.push("Certified");
  return pills.slice(0, 3);
}

export function ProductCard({ product, className }: { product: Product; className?: string }) {
  const wish = useShopStore((s) => s.wishlist.includes(product.id));
  const toggle = useShopStore((s) => s.toggleWishlist);
  const addToCart = useShopStore((s) => s.addToCart);
  const { toast } = useToast();
  const price = displayPrice(product);
  const pills = useMemo(() => productSpecPills(product), [product]);
  const hoverSrc =
    product.images.find((src, i) => i > 0 && src && src !== product.images[0]) ??
    (product.lifestyleImage && product.lifestyleImage !== product.images[0] ? product.lifestyleImage : null);
  const showHoverImage = Boolean(hoverSrc);
  const sku = product.variants.find((v) => v.stock > 0)?.sku ?? product.variants[0]?.sku;
  const inStock = variantStock(product) > 0;
  const [pop, setPop] = useState(false);

  function onWish(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    toggle(product.id);
    trackEvent({
      eventType: wish ? "WISHLIST_REMOVE" : "WISHLIST_ADD",
      productId: product.id,
      categoryId: product.categoryId,
    });
    setPop(true);
    toast(wish ? "Removed from wishlist" : "Saved to wishlist");
    window.setTimeout(() => setPop(false), 350);
  }

  function onAdd(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!inStock || !sku) {
      toast("This piece is currently out of stock");
      return;
    }
    addToCart(product.id, sku, 1);
    trackEvent({
      eventType: "ADD_TO_CART",
      productId: product.id,
      categoryId: product.categoryId,
    });
    toast("Added to bag");
  }

  return (
    <article
      className={cn(
        "luxury-product-card group h-full",
        showHoverImage && "has-alt-image",
        className,
      )}
    >
      <div className="luxury-product-card__media">
        <Link
          href={`/product/${product.slug}`}
          className="absolute inset-0 block"
          aria-label={product.name}
          onClick={() => trackEvent({ eventType: "PRODUCT_CLICK", productId: product.id, categoryId: product.categoryId })}
        >
          <ProductImage
            src={product.images[0]}
            alt={product.name}
            fill
            className="luxury-product-card__image object-cover"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
          {showHoverImage && hoverSrc && (
            <ProductImage
              src={hoverSrc}
              alt=""
              fill
              className="luxury-product-card__image-alt absolute inset-0 z-[1] object-cover"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            />
          )}
        </Link>

        {product.newArrival && (
          <span className="absolute left-3 top-3 z-20 rounded-full bg-primary px-2.5 py-0.5 text-[9px] tracking-[0.14em] text-background uppercase">
            New
          </span>
        )}

        <button
          type="button"
          onClick={onWish}
          className={cn("luxury-product-card__wish rounded-full", pop && "heart-pop")}
          aria-label={wish ? "Remove from wishlist" : "Save to wishlist"}
        >
          <Heart size={14} fill={wish ? "currentColor" : "none"} className={wish ? "text-primary" : "text-ink-soft"} />
        </button>
      </div>

      <div className="luxury-product-card__body">
        <Link href={`/product/${product.slug}`} className="luxury-product-card__name line-clamp-2">
          {product.name}
        </Link>
        <p className="luxury-product-card__price">
          {formatINR(price.from)}
          {price.onSale && (
            <span className="ml-2 opacity-60 line-through">{formatINR(price.originalFrom)}</span>
          )}
        </p>
        {pills.length > 0 && (
          <div className="luxury-pills">
            {pills.map((pill) => (
              <span key={pill} className="luxury-pill">
                {pill}
              </span>
            ))}
          </div>
        )}
        <button type="button" onClick={onAdd} disabled={!inStock} className="btn-primary">
          {inStock ? "Add to bag" : "Out of stock"}
        </button>
      </div>
    </article>
  );
}

export function ProductGrid({ products, className }: { products: Product[]; className?: string }) {
  if (!products.length) {
    return <p className="py-16 text-center text-ink-soft">No products match these filters.</p>;
  }
  return (
    <div className={cn("grid grid-cols-2 items-stretch gap-x-4 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:gap-x-6 xl:grid-cols-4", className)}>
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}

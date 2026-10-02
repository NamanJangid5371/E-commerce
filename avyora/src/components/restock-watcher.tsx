"use client";

import { useToast } from "@/components/toast";
import { isPublished, useShopStore } from "@/store/shop-store";
import { useEffect, useRef } from "react";

/** Toast when a wishlisted / alerted product comes back in stock. */
export function RestockWatcher() {
  const { toast } = useToast();
  const user = useShopStore((s) => s.user);
  const customers = useShopStore((s) => s.customers);
  const catalog = useShopStore((s) => s.catalog);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user || user.role !== "customer") return;
    const customer = customers.find((c) => c.email.toLowerCase() === user.email.toLowerCase());
    const alerts = customer?.restockAlerts ?? [];
    const wishlist = useShopStore.getState().wishlist;
    const watch = new Set([...alerts, ...wishlist]);
    for (const id of watch) {
      const product = catalog.find((p) => p.id === id);
      if (!product || !isPublished(product)) continue;
      const inStock = product.variants.some((v) => v.stock > 0);
      const key = `${id}:${inStock}`;
      if (inStock && !seen.current.has(key) && seen.current.has(`${id}:false`)) {
        toast(`${product.name} is back in stock`);
      }
      seen.current.add(key);
    }
  }, [catalog, customers, user, toast]);

  return null;
}

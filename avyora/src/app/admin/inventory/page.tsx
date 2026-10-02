"use client";

import { ClearableNumberInput } from "@/components/admin/clearable-number-input";
import { fetchJson } from "@/lib/api-client";
import { useShopStore } from "@/store/shop-store";
import { useEffect, useMemo, useState } from "react";

type DraftKey = string;

function draftKey(productId: string, sku: string): DraftKey {
  return `${productId}::${sku}`;
}

export default function InventoryPage() {
  const catalog = useShopStore((s) => s.catalog);
  const ops = useShopStore((s) => s.ops);
  const setVariantStock = useShopStore((s) => s.setVariantStock);
  const [reason, setReason] = useState("Manual adjustment");
  const [view, setView] = useState<"all" | "low" | "out">("all");
  const [q, setQ] = useState("");
  /** Pending stock edits keyed by productId::sku */
  const [drafts, setDrafts] = useState<Record<DraftKey, number>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [liveLoaded, setLiveLoaded] = useState(false);

  // Align admin UI with Postgres stock (what checkout actually uses).
  useEffect(() => {
    let cancelled = false;
    void fetchJson<{
      variants: { sku: string; stock: number }[];
    }>("/api/admin/inventory").then((res) => {
      if (cancelled || !res.ok) {
        if (!cancelled) setLiveLoaded(true);
        return;
      }
      const bySku = new Map(res.data.variants.map((v) => [v.sku, v.stock]));
      const current = useShopStore.getState().catalog;
      let changed = false;
      const nextCatalog = current.map((product) => {
        let productChanged = false;
        const variants = product.variants.map((variant) => {
          const live = bySku.get(variant.sku);
          if (live === undefined || live === variant.stock) return variant;
          productChanged = true;
          changed = true;
          return { ...variant, stock: live };
        });
        return productChanged ? { ...product, variants } : product;
      });
      if (changed) {
        useShopStore.setState({ catalog: nextCatalog });
      }
      if (!cancelled) setLiveLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const query = q.trim().toLowerCase();

  const rows = useMemo(() => {
    return catalog
      .flatMap((p) => p.variants.map((v) => ({ p, v, min: p.minStock ?? 3 })))
      .filter(({ p, v, min }) => {
        if (view === "low") {
          if (!(v.stock > 0 && v.stock <= min)) return false;
        } else if (view === "out") {
          if (v.stock !== 0) return false;
        }
        if (!query) return true;
        const haystack = `${p.name} ${p.slug} ${p.category} ${v.sku} ${v.size ?? ""} ${v.colour} ${v.purity}`.toLowerCase();
        return haystack.includes(query);
      });
  }, [catalog, view, query]);

  const stockMoves = useMemo(() => {
    const moves = ops?.stockMoves ?? [];
    if (!query) return moves.slice(0, 20);
    return moves
      .filter((m) => `${m.sku} ${m.reason} ${m.actor}`.toLowerCase().includes(query))
      .slice(0, 20);
  }, [ops?.stockMoves, query]);

  const dirtyCount = useMemo(() => {
    let count = 0;
    for (const { p, v } of rows) {
      const key = draftKey(p.id, v.sku);
      if (key in drafts && drafts[key] !== v.stock) count += 1;
    }
    return count;
  }, [rows, drafts]);

  function setDraft(productId: string, sku: string, next: number, current: number) {
    const key = draftKey(productId, sku);
    setDrafts((prev) => {
      if (next === current) {
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      return { ...prev, [key]: next };
    });
    setMessage(null);
  }

  async function updateInventory() {
    if (busy) return;
    setBusy(true);
    setMessage(null);

    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    const pending = await new Promise<Record<DraftKey, number>>((resolve) => {
      setDrafts((current) => {
        resolve(current);
        return current;
      });
    });

    const changes: { productId: string; sku: string; stock: number }[] = [];
    for (const { p, v } of catalog.flatMap((p) => p.variants.map((v) => ({ p, v })))) {
      const key = draftKey(p.id, v.sku);
      if (!(key in pending)) continue;
      const next = pending[key];
      if (next === v.stock) continue;
      changes.push({ productId: p.id, sku: v.sku, stock: next });
    }

    if (!changes.length) {
      setMessage("No stock changes to update.");
      setBusy(false);
      return;
    }

    const adjustmentReason = reason.trim() || "Manual adjustment";

    const res = await fetchJson<{
      updated: number;
    }>("/api/admin/inventory", {
      method: "PATCH",
      body: JSON.stringify({
        reason: adjustmentReason,
        adjustments: changes.map((c) => ({
          sku: c.sku,
          stock: c.stock,
          reason: adjustmentReason,
        })),
      }),
    });

    if (!res.ok) {
      setMessage(res.error || "Could not update live inventory. Sign in again at /staff-login.");
      setBusy(false);
      return;
    }

    for (const change of changes) {
      setVariantStock(change.productId, change.sku, change.stock, adjustmentReason);
    }
    setDrafts({});
    setMessage(
      `Updated ${res.data.updated} stock row${res.data.updated === 1 ? "" : "s"} in the live database (checkout).`,
    );
    setBusy(false);
  }

  async function repairCheckoutStock() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const res = await fetchJson<{ updated: number; message?: string }>("/api/admin/inventory", {
      method: "POST",
      body: JSON.stringify({ mode: "sync-from-catalog" }),
    });
    if (!res.ok) {
      setMessage(res.error || "Could not sync catalog stock to checkout.");
      setBusy(false);
      return;
    }
    // Reload live stock into the table.
    const live = await fetchJson<{ variants: { sku: string; stock: number }[] }>("/api/admin/inventory");
    if (live.ok) {
      const bySku = new Map(live.data.variants.map((v) => [v.sku, v.stock]));
      const current = useShopStore.getState().catalog;
      useShopStore.setState({
        catalog: current.map((product) => ({
          ...product,
          variants: product.variants.map((variant) => {
            const next = bySku.get(variant.sku);
            return next === undefined ? variant : { ...variant, stock: next };
          }),
        })),
      });
    }
    setDrafts({});
    setMessage(res.data.message || `Synced ${res.data.updated} stock row(s) to checkout.`);
    setBusy(false);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium tracking-tight">Inventory & stock</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Edit stock, then click Update inventory. Checkout uses the live database — not the old JSON file alone.
            {liveLoaded ? "" : " Loading live stock…"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void repairCheckoutStock()}
            disabled={busy}
            className="border border-line bg-transparent px-5 py-2.5 text-xs uppercase tracking-widest text-ink transition hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Working…" : "Repair checkout stock"}
          </button>
          <button
            type="button"
            onClick={() => void updateInventory()}
            disabled={busy || dirtyCount === 0}
            className="bg-ink px-5 py-2.5 text-xs uppercase tracking-widest text-ivory transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Updating…" : dirtyCount > 0 ? `Update inventory (${dirtyCount})` : "Update inventory"}
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-[16rem] flex-1 border border-line bg-transparent px-3 py-2 text-sm"
          placeholder="Search name, SKU, category, finish…"
          aria-label="Search inventory"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="border border-line bg-transparent px-3 py-2 text-sm"
          placeholder="Adjustment reason"
        />
        <select
          value={view}
          onChange={(e) => setView(e.target.value as typeof view)}
          className="border border-line bg-transparent px-3 py-2 text-sm"
        >
          <option value="all">All</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </select>
      </div>

      {message && (
        <p
          className={`mt-3 text-sm ${message.startsWith("Updated") ? "text-ink" : "text-red-800"}`}
          role="status"
        >
          {message}
        </p>
      )}

      <p className="mt-3 text-xs text-ink-soft">
        {rows.length} variant{rows.length === 1 ? "" : "s"}
        {query ? ` matching “${q.trim()}”` : ""}
        {view !== "all" ? ` · ${view === "low" ? "low stock" : "out of stock"}` : ""}
        {dirtyCount > 0 ? ` · ${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"}` : ""}
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-widest text-gold-deep">
            <tr>
              <th className="py-3">Product</th>
              <th>SKU</th>
              <th>Finish</th>
              <th>Stock</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, v, min }) => {
              const key = draftKey(p.id, v.sku);
              const displayStock = key in drafts ? drafts[key] : v.stock;
              const dirty = key in drafts && drafts[key] !== v.stock;
              return (
                <tr key={v.sku} className="border-t border-line">
                  <td className="py-3">{p.name}</td>
                  <td>{v.sku}</td>
                  <td>
                    {v.size ?? "—"} · {v.colour} {v.purity}
                  </td>
                  <td>
                    <ClearableNumberInput
                      value={displayStock}
                      min={0}
                      aria-label={`Stock for ${v.sku}`}
                      onCommit={(next) => setDraft(p.id, v.sku, next, v.stock)}
                      className={`w-24 border bg-transparent px-2 py-1 ${
                        dirty ? "border-gold-deep" : displayStock <= min ? "border-red-800" : "border-line"
                      }`}
                    />
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="border-t border-line py-8 text-ink-soft">
                  No stock rows match this search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <h2 className="mt-10 text-lg font-medium">Stock movement</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {stockMoves.map((m) => (
          <li key={m.id}>
            {new Date(m.at).toLocaleString("en-IN")} · {m.sku} · {m.delta > 0 ? "+" : ""}
            {m.delta} · {m.reason} · {m.actor}
          </li>
        ))}
        {!stockMoves.length && (
          <li className="text-ink-soft">{query ? "No movements match this search." : "No adjustments recorded."}</li>
        )}
      </ul>
    </div>
  );
}

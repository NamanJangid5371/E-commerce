"use client";

import { useShopStore } from "@/store/shop-store";

export default function SearchAdmin() {
  const ops = useShopStore((s) => s.ops);
  const catalog = useShopStore((s) => s.catalog);
  const upsertProduct = useShopStore((s) => s.upsertProduct);

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Search insights</h1>
      <p className="mt-1 text-sm text-ink-soft">Popular queries, zero-result searches, and product search visibility.</p>
      <div className="mt-8 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-widest text-gold-deep">
            <tr>
              <th className="py-3">Query</th>
              <th>Count</th>
              <th>Results</th>
            </tr>
          </thead>
          <tbody>
            {ops.searches.map((s) => (
              <tr key={s.query} className="border-t border-line">
                <td className="py-3">{s.query}</td>
                <td>{s.count}</td>
                <td className={s.results === 0 ? "text-red-800" : ""}>{s.results === 0 ? "No results" : s.results}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="mt-10 text-lg font-medium">Searchable products</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {catalog.map((p) => (
          <li key={p.id} className="flex items-center justify-between border-b border-line py-2">
            <span>{p.name}</span>
            <label className="flex items-center gap-2 text-xs uppercase tracking-widest">
              <input
                type="checkbox"
                checked={p.searchable !== false}
                onChange={(e) => upsertProduct({ ...p, searchable: e.target.checked })}
              />
              Visible in search
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

import { useShopStore } from "@/store/shop-store";
import { useMemo, useState } from "react";

export default function ReviewsAdmin() {
  const catalog = useShopStore((s) => s.catalog);
  const setReviewStatus = useShopStore((s) => s.setReviewStatus);
  const [productQ, setProductQ] = useState("");
  const [rating, setRating] = useState("all");
  const [status, setStatus] = useState("all");
  const rows = useMemo(() => {
    return catalog.flatMap((p) => p.reviews.map((r) => ({ product: p, review: r }))).filter(({ product, review }) => {
      const matchP = !productQ || product.name.toLowerCase().includes(productQ.toLowerCase());
      const matchR = rating === "all" || String(review.rating) === rating;
      const matchS = status === "all" || (review.status ?? "visible") === status;
      return matchP && matchR && matchS;
    });
  }, [catalog, productQ, rating, status]);

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Reviews</h1>
      <p className="mt-1 text-sm text-ink-soft">Hidden reviews do not appear on the product page.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <input value={productQ} onChange={(e) => setProductQ(e.target.value)} placeholder="Filter by product" className="border border-line bg-transparent px-3 py-2 text-sm" />
        <select value={rating} onChange={(e) => setRating(e.target.value)} className="border border-line bg-transparent px-3 py-2 text-sm">
          <option value="all">All ratings</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n} stars
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-line bg-transparent px-3 py-2 text-sm">
          <option value="all">All statuses</option>
          <option value="visible">Visible</option>
          <option value="hidden">Hidden</option>
          <option value="pending">Pending</option>
        </select>
      </div>
      <div className="mt-8 space-y-4">
        {rows.map(({ product, review }) => (
          <div key={review.id} className="border border-line p-4">
            <p className="font-medium">
              {review.title} · {review.rating}/5
            </p>
            <p className="text-sm text-ink-soft">
              {product.name} · {review.author} · {review.status ?? "visible"}
            </p>
            <p className="mt-2 text-sm">{review.body}</p>
            <div className="mt-3 space-x-3 text-xs uppercase tracking-widest">
              <button onClick={() => setReviewStatus(product.id, review.id, "visible")}>Show</button>
              <button onClick={() => setReviewStatus(product.id, review.id, "hidden")}>Hide</button>
              <button onClick={() => setReviewStatus(product.id, review.id, "pending")}>Pending</button>
            </div>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-ink-soft">No reviews in this view.</p>}
      </div>
    </div>
  );
}

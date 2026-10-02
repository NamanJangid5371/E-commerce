"use client";

import { ProductForm } from "@/components/admin/product-form";
import { useShopStore } from "@/store/shop-store";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const product = useShopStore((s) => s.catalog.find((p) => p.id === id));

  if (!product) {
    return (
      <div>
        <p>Product not found.</p>
        <Link href="/admin/products" className="mt-4 inline-block text-sm underline">
          Back
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-8 text-3xl font-medium tracking-tight">Edit {product.name}</h1>
      <ProductForm initial={product} mode="edit" />
    </div>
  );
}

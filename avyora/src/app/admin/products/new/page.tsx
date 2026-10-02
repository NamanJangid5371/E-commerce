"use client";

import { ProductForm, emptyProduct } from "@/components/admin/product-form";

export default function NewProductPage() {
  return (
    <div>
      <h1 className="mb-8 text-3xl font-medium tracking-tight">New product</h1>
      <ProductForm initial={emptyProduct()} mode="create" />
    </div>
  );
}

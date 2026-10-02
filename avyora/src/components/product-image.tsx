"use client";

import { cn } from "@/lib/cn";
import Image, { type ImageProps } from "next/image";
import { useEffect, useState } from "react";

export const PRODUCT_IMAGE_FALLBACK = "/products/necklace-1.jpg";

type Props = Omit<ImageProps, "src" | "alt"> & {
  src?: string | null;
  alt: string;
};

export function ProductImage({ src, alt, className, onError, ...props }: Props) {
  const initial = src || PRODUCT_IMAGE_FALLBACK;
  const [current, setCurrent] = useState(initial);

  useEffect(() => {
    setCurrent(src || PRODUCT_IMAGE_FALLBACK);
  }, [src]);

  return (
    <Image
      {...props}
      src={current}
      alt={alt}
      unoptimized={current.startsWith("/products/")}
      className={cn("bg-ivory object-cover", className)}
      onError={(e) => {
        if (current !== PRODUCT_IMAGE_FALLBACK) setCurrent(PRODUCT_IMAGE_FALLBACK);
        onError?.(e);
      }}
    />
  );
}

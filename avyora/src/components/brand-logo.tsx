"use client";

import { BRAND_LOGO_ALT, BRAND_LOGO_SRC } from "@/lib/brand";
import { cn } from "@/lib/cn";
import Image from "next/image";
import Link from "next/link";

export { BRAND_LOGO_ALT, BRAND_LOGO_SRC };

type Size = "sm" | "md" | "lg" | "header";

const heights: Record<Size, string> = {
  sm: "h-14 w-14 sm:h-16 sm:w-16",
  md: "h-[4.5rem] w-[4.5rem] sm:h-[5.25rem] sm:w-[5.25rem]",
  lg: "h-[5rem] w-[5rem] sm:h-[6rem] sm:w-[6rem]",
  /** Large mark that fills the storefront top bar; CSS shrinks on scroll. */
  header: "luxury-header__logo-img h-[4.75rem] w-[4.75rem] sm:h-[5.5rem] sm:w-[5.5rem]",
};

export function BrandLogo({
  href,
  inverted = false,
  caption,
  size = "md",
  className,
  /** @deprecated Logo artwork includes the brand name */
  name: _name,
}: {
  name?: string;
  href?: string;
  inverted?: boolean;
  caption?: string;
  size?: Size;
  className?: string;
}) {
  const inner = (
    <span className={cn("inline-flex flex-col items-start", className)}>
      <span
        className={cn(
          "relative block shrink-0 overflow-hidden",
          size === "header" && "luxury-header__logo-frame",
          !inverted && "rounded-lg shadow-[0_4px_18px_rgba(0,0,0,0.35)] ring-1 ring-[rgba(212,175,55,0.35)]",
        )}
      >
        <Image
          src={BRAND_LOGO_SRC}
          alt={BRAND_LOGO_ALT}
          width={512}
          height={512}
          unoptimized
          priority
          className={cn("block object-contain", heights[size])}
        />
      </span>
      {caption ? (
        <span
          className={cn(
            "mt-1.5 text-[9px] font-semibold tracking-[0.28em] uppercase sm:text-[10px]",
            inverted ? "text-ivory/70" : "text-ink-soft",
          )}
        >
          {caption}
        </span>
      ) : null}
    </span>
  );

  if (!href) return inner;
  return (
    <Link
      href={href}
      className={cn("shrink-0", size === "header" && "luxury-header__logo")}
      aria-label={BRAND_LOGO_ALT}
    >
      {inner}
    </Link>
  );
}

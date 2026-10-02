import type { ComponentType, ReactNode } from "react";

export type CategoryNavIconProps = {
  className?: string;
  size?: number;
};

function Svg({
  size = 28,
  className,
  children,
}: CategoryNavIconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

const stroke = {
  stroke: "currentColor",
  strokeWidth: 1.55,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconShop(props: CategoryNavIconProps) {
  return (
    <Svg {...props}>
      <path {...stroke} d="M7.5 5h9l1.2 3.2H6.3L7.5 5Z" />
      <path {...stroke} d="M6.5 8.2c0 4.2 2.4 7.6 5.5 7.6s5.5-3.4 5.5-7.6" />
      <circle cx="12" cy="15.1" r="1.35" fill="currentColor" />
      <circle cx="12" cy="15.1" r=".45" fill="none" stroke="currentColor" strokeWidth="0.9" />
    </Svg>
  );
}

export function IconRings(props: CategoryNavIconProps) {
  return (
    <Svg {...props}>
      <ellipse {...stroke} cx="12" cy="14.2" rx="5.8" ry="3.35" />
      <path {...stroke} d="M9.2 11.1c.9-1.8 2.2-2.8 2.8-2.8s1.9 1 2.8 2.8" />
      <path {...stroke} d="M12 8.3V6.5M9.9 7l-1.35-.9M14.1 7l1.35-.9" />
      <circle cx="12" cy="5.9" r="1.2" fill="currentColor" />
      <circle cx="12" cy="5.9" r=".4" fill="none" stroke="currentColor" strokeWidth="0.85" opacity="0.55" />
    </Svg>
  );
}

export function IconNecklaces(props: CategoryNavIconProps) {
  return (
    <Svg {...props}>
      <path {...stroke} d="M6.2 5.2c0 4.4 2.5 7.9 5.8 7.9s5.8-3.5 5.8-7.9" />
      <path {...stroke} d="M8.2 5.2h7.6" />
      <path {...stroke} d="M12 13.1v2.6" />
      <circle cx="12" cy="17.4" r="1.55" fill="currentColor" />
      <circle cx="12" cy="17.4" r=".5" fill="none" stroke="currentColor" strokeWidth="0.9" opacity="0.55" />
    </Svg>
  );
}

export function IconEarrings(props: CategoryNavIconProps) {
  return (
    <Svg {...props}>
      <circle cx="7.6" cy="4.7" r="1.05" fill="currentColor" />
      <path {...stroke} d="M7.6 5.7v2.2" />
      <circle {...stroke} cx="7.6" cy="10.4" r="1.75" />
      <circle cx="7.6" cy="10.4" r=".65" fill="currentColor" />

      <circle cx="16.4" cy="4.7" r="1.05" fill="currentColor" />
      <path {...stroke} d="M16.4 5.7v2.2" />
      <circle {...stroke} cx="16.4" cy="10.4" r="1.75" />
      <circle cx="16.4" cy="10.4" r=".65" fill="currentColor" />

      <path {...stroke} d="M6.55 4.55c0-.7.55-1.2 1.15-1.2M17.45 4.55c0-.7-.55-1.2-1.15-1.2" />
    </Svg>
  );
}

export function IconBracelets(props: CategoryNavIconProps) {
  return (
    <Svg {...props}>
      <ellipse {...stroke} cx="12" cy="12" rx="6.8" ry="4.35" transform="rotate(-18 12 12)" />
      <ellipse {...stroke} cx="12" cy="12" rx="5" ry="3.1" transform="rotate(-18 12 12)" />
      <circle cx="17.2" cy="9.4" r=".85" fill="currentColor" />
    </Svg>
  );
}

export function IconPendants(props: CategoryNavIconProps) {
  return (
    <Svg {...props}>
      <path {...stroke} d="M12 3.8v4.4" />
      <path
        {...stroke}
        d="M12 8.2c-2.35 0-3.85 1.5-3.85 3.55 0 2.45 1.7 4.35 3.85 6.45 2.15-2.1 3.85-4 3.85-6.45 0-2.05-1.5-3.55-3.85-3.55Z"
      />
      <circle cx="12" cy="3.8" r="1" fill="currentColor" />
      <circle cx="12" cy="12.1" r=".7" fill="currentColor" opacity="0.85" />
    </Svg>
  );
}

export function IconAtelier(props: CategoryNavIconProps) {
  return (
    <Svg {...props}>
      <path {...stroke} d="M4.8 18.2h14.4" />
      <path {...stroke} d="M7.6 18.2V9l4.4-3.3L16.4 9v9.2" />
      <path {...stroke} d="M10 12.2h4M10 15.2h4" />
      <path {...stroke} d="M12 5.7V4.2" />
      <circle cx="12" cy="3.6" r=".75" fill="currentColor" />
    </Svg>
  );
}

export function IconCeleste(props: CategoryNavIconProps) {
  return (
    <Svg {...props}>
      <path
        {...stroke}
        d="M12 3.8l1.25 3.7h3.9l-3.15 2.3 1.2 3.7L12 11.5l-3.2 2 1.2-3.7-3.15-2.3h3.9L12 3.8Z"
      />
      <circle cx="18" cy="5.4" r=".85" fill="currentColor" />
      <circle cx="5.6" cy="7.2" r=".55" fill="currentColor" opacity="0.75" />
    </Svg>
  );
}

export function IconFlora(props: CategoryNavIconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="2.15" fill="currentColor" opacity="0.9" />
      <circle {...stroke} cx="12" cy="12" r="2.15" />
      <path
        {...stroke}
        d="M12 9.7V4.8M12 14.3v4.9M9.7 12H4.8M14.3 12h4.9M10.4 10.4 7.1 7.1M16.9 16.9l-3.3-3.3M13.6 10.4l3.3-3.3M7.1 16.9l3.3-3.3"
      />
    </Svg>
  );
}

export function IconMaison(props: CategoryNavIconProps) {
  return (
    <Svg {...props}>
      <path {...stroke} d="M4.2 18.2V9.2L12 4.4l7.8 4.8v9" />
      <path {...stroke} d="M9 18.2v-5.2h6v5.2" />
      <path {...stroke} d="M6.2 10.4 12 7.2l5.8 3.2" />
      <circle cx="12" cy="12.6" r=".7" fill="currentColor" />
    </Svg>
  );
}

export function IconCollection(props: CategoryNavIconProps) {
  return (
    <Svg {...props}>
      <rect {...stroke} x="4.8" y="5.8" width="14.4" height="12.4" rx="1.8" />
      <path {...stroke} d="M8.2 10.2h7.6M8.2 13.4h5.2" />
      <path {...stroke} d="M8.8 5.8V4.5h6.4V5.8" />
    </Svg>
  );
}

const CATEGORY_ICONS: Record<string, ComponentType<CategoryNavIconProps>> = {
  shop: IconShop,
  rings: IconRings,
  necklaces: IconNecklaces,
  earrings: IconEarrings,
  bracelets: IconBracelets,
  pendants: IconPendants,
  atelier: IconAtelier,
  celeste: IconCeleste,
  flora: IconFlora,
  maison: IconMaison,
};

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function getCategoryNavIcon(label: string, href: string): ComponentType<CategoryNavIconProps> {
  if (href === "/shop") return IconShop;
  if (href === "/about") return IconMaison;

  if (href.startsWith("/collections/")) {
    const slug = href.replace("/collections/", "");
    return CATEGORY_ICONS[slug] ?? IconCollection;
  }

  const labelKey = normalizeKey(label);
  if (CATEGORY_ICONS[labelKey]) return CATEGORY_ICONS[labelKey];

  const partial = Object.keys(CATEGORY_ICONS).find((key) => labelKey.includes(key) || key.includes(labelKey));
  if (partial) return CATEGORY_ICONS[partial];

  return IconCollection;
}

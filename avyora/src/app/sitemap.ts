import { collections, products } from "@/data/catalog";

export default function sitemap() {
  const base = "https://avyora.example.com";
  return [
    { url: base, lastModified: new Date() },
    { url: `${base}/shop`, lastModified: new Date() },
    { url: `${base}/visit`, lastModified: new Date() },
    { url: `${base}/about`, lastModified: new Date() },
    ...products.map((p) => ({ url: `${base}/product/${p.slug}`, lastModified: new Date() })),
    ...collections.map((c) => ({ url: `${base}/collections/${c.slug}`, lastModified: new Date() })),
  ];
}

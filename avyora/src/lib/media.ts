export const MEDIA_LIBRARY = [
  "/products/ring-1.jpg",
  "/products/ring-2.jpg",
  "/products/ring-3.jpg",
  "/products/ring-4.jpg",
  "/products/ring-5.jpg",
  "/products/ring-6.jpg",
  "/products/necklace-1.jpg",
  "/products/necklace-2.jpg",
  "/products/necklace-3.jpg",
  "/products/necklace-4.jpg",
  "/products/necklace-5.jpg",
  "/products/earring-1.jpg",
  "/products/earring-2.jpg",
  "/products/earring-3.jpg",
  "/products/earring-4.jpg",
  "/products/bracelet-1.jpg",
  "/products/bracelet-2.jpg",
  "/products/bracelet-3.jpg",
  "/products/bracelet-4.jpg",
  "/products/pendant-1.jpg",
  "/products/pendant-2.jpg",
  "/products/pendant-3.jpg",
  "/products/life-1.jpg",
  "/products/life-2.jpg",
  "/products/life-3.jpg",
  "/products/life-4.jpg",
];

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

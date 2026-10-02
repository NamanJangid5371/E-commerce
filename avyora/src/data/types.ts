export type Metal = "Gold" | "Silver" | "Platinum";
/** Display name; must match an entry in ops.categories (admin-managed). */
export type Category = string;
export type ProductStatus = "draft" | "published" | "archived";
export type ReviewStatus = "pending" | "visible" | "hidden";

export type ProductVariant = {
  sku: string;
  size?: string;
  metal: Metal;
  purity: string;
  colour: string;
  stock: number;
  price: number;
  salePrice?: number;
};

export type Review = {
  id: string;
  author: string;
  rating: number;
  title: string;
  body: string;
  date: string;
  verified: boolean;
  status?: ReviewStatus;
};

export type Product = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  brand: string;
  category: Category;
  /** Links product to admin category record for filtering and launch. */
  categoryId?: string;
  collection: string;
  tags: string[];
  description: string;
  story: string;
  metal: Metal;
  purity: string;
  colour: string;
  stone?: string;
  cut?: string;
  clarity?: string;
  carat?: string;
  weight: string;
  dimensions: string;
  makingCharge: number;
  taxNote: string;
  images: string[];
  /** When false, gallery is stills only. Default: spin if 3+ photos. */
  spinEnabled?: boolean;
  lifestyleImage?: string;
  certificateNumber: string;
  certifiedBy: string;
  warranty: string;
  care: string;
  returnPolicy: string;
  seoTitle: string;
  seoDescription: string;
  featured?: boolean;
  bestSeller?: boolean;
  newArrival?: boolean;
  rating: number;
  reviewCount: number;
  reviews: Review[];
  variants: ProductVariant[];
  status?: ProductStatus;
  shortDescription?: string;
  searchable?: boolean;
  relatedSlugs?: string[];
  togetherSlugs?: string[];
  minStock?: number;
  available?: boolean;
};

export type Collection = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  image: string;
  productSlugs: string[];
};

export type Address = {
  id: string;
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
};

export type CartItem = {
  productId: string;
  sku: string;
  quantity: number;
};

export type OrderStatus =
  | "Pending Payment"
  | "Confirmed"
  | "Packed"
  | "Shipped"
  | "Delivered"
  | "Return Requested"
  | "Refunded";

export type OrderItem = {
  productId: string;
  sku: string;
  name: string;
  image: string;
  quantity: number;
  price: number;
};

export type Order = {
  id: string;
  createdAt: string;
  status: OrderStatus;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
  coupon?: string;
  address: Address;
  paymentId: string;
  trackingId?: string;
};

export type Coupon = {
  code: string;
  type: "percent" | "flat" | "free_shipping";
  value: number;
  minOrder: number;
  label: string;
  active?: boolean;
  usageCount?: number;
  maxDiscount?: number;
  usageLimit?: number;
  startsAt?: string;
  endsAt?: string;
  productSlugs?: string[];
  categoryNames?: string[];
  groupIds?: string[];
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: "customer" | "admin";
};

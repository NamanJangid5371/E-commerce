"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

/** Delivery partner desk moved to Local Dispatch. */
export default function DeliveryPartnerCodRedirectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => {
    const orderId = Array.isArray(id) ? id[0] : id;
    router.replace(orderId ? `/logistics/dispatch/${encodeURIComponent(orderId)}` : "/logistics/dispatch");
  }, [id, router]);
  return <p className="text-sm text-ink-soft">Redirecting to Local Dispatch…</p>;
}

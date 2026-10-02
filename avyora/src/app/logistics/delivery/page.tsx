"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Delivery partner desk moved to Local Dispatch. */
export default function DeliveryPartnerRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/logistics/dispatch");
  }, [router]);
  return <p className="text-sm text-ink-soft">Redirecting to Local Dispatch…</p>;
}

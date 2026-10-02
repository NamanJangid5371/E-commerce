"use client";

import { faqs, policies, site } from "@/data/content";
import { useShopStore } from "@/store/shop-store";
import Image from "next/image";
import Link from "next/link";

export default function AboutPage() {
  const page = useShopStore((s) => s.ops?.pages.find((p) => p.slug === "about" && p.published));
  const settings = useShopStore((s) => s.ops?.settings);
  return (
    <div>
      <section className="relative h-[50vh] min-h-[360px]">
        <Image src="/products/life-2.jpg" alt="" fill className="object-cover" />
        <div className="absolute inset-0 bg-primary/50" />
        <div className="relative flex h-full items-end px-4 pb-12">
          <div className="mx-auto w-full max-w-7xl text-background">
            <p className="text-[11px] tracking-[0.24em] uppercase text-secondary">Maison</p>
            <h1 className="mt-2 font-serif text-6xl">{page?.title ?? "The atelier"}</h1>
          </div>
        </div>
      </section>
      <div className="mx-auto max-w-3xl px-4 py-20 text-sm leading-8">
        <p>{page?.body ?? "Avyora is a Bengaluru jewellery house built around proportion, hallmarking and a calm client experience."}</p>
        <p className="mt-6 text-ink-soft">
          {settings?.address ?? site.address} · {settings?.phone ?? site.phone}
          <br />
          {settings?.hours ?? "Tue–Sun, 11:00–19:00"} · Visits by appointment
        </p>
        <Link href="/visit" className="btn-primary mt-8 inline-flex">
          Book a viewing
        </Link>
      </div>
    </div>
  );
}

export function CmsFaqPage() {
  const page = useShopStore((s) => s.ops?.pages.find((p) => p.slug === "faq" && p.published));
  return (
    <div className="mx-auto max-w-3xl px-4 py-20">
      <h1 className="font-serif text-5xl">{page?.title ?? "Questions"}</h1>
      {page?.body ? <p className="mt-6 text-sm leading-7 text-ink-soft">{page.body}</p> : null}
      <div className="mt-12 space-y-8">
        {faqs.map((f) => (
          <div key={f.q} className="border-b border-line pb-8">
            <h2 className="font-serif text-2xl">{f.q}</h2>
            <p className="mt-3 text-sm leading-7 text-ink-soft">{f.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CmsPolicyPage({ slug }: { slug: string }) {
  const cms = useShopStore((s) => s.ops?.pages.find((p) => p.slug === slug && p.published));
  const policy = policies.find((p) => p.slug === slug);
  const title = cms?.title ?? policy?.title;
  const body = cms?.body ?? policy?.body;
  if (!title || !body) {
    return <p className="px-4 py-20">Page not found.</p>;
  }
  return (
    <div className="mx-auto max-w-3xl px-4 py-20">
      <h1 className="font-serif text-5xl">{title}</h1>
      <p className="mt-8 text-sm leading-8 text-ink-soft">{body}</p>
    </div>
  );
}

"use client";

import { pickHeroBanner, pickPromoBanners, pickStripBanners } from "@/components/admin/banner-editor";
import { ProductCard } from "@/components/product-card";
import { PersonalizedRecommendations } from "@/components/personalized-recommendations";
import { Reveal } from "@/components/reveal";
import { hero } from "@/data/content";
import { buildHomepageProductSets } from "@/lib/homepage-products";
import { useLiveCatalog, useShopStore } from "@/store/shop-store";
import Image from "next/image";
import Link from "next/link";

export default function Home() {
  const { products, collections, campaigns, ops } = useLiveCatalog();
  const hydrated = useShopStore((s) => s.hydrated);
  const banners = ops?.banners ?? [];
  const heroBanner = pickHeroBanner(banners);
  const promoBanners = pickPromoBanners(banners);
  const stripBanners = pickStripBanners(banners);
  const sections = [...(ops?.homepageSections ?? [])].sort((a, b) => a.order - b.order);
  const on = (id: string) => sections.find((s) => s.id === id)?.enabled !== false;

  const campaign = campaigns.find((c) => c.active) ?? campaigns[0];
  // All live promo banners from Banners admin; fall back to a single Campaigns entry if none.
  const promoBlocks =
    promoBanners.length > 0
      ? promoBanners.map((banner) => ({
          id: banner.id,
          title: banner.title,
          body: banner.description,
          image: banner.image,
          href: banner.href,
          cta: banner.cta || "Shop this offer",
        }))
      : campaign
        ? [
            {
              id: campaign.id,
              title: campaign.title,
              body: campaign.body,
              image: campaign.image,
              href: campaign.href,
              cta: "Shop this offer",
            },
          ]
        : [];

  const { heroProduct, sideProducts, gridProducts } = buildHomepageProductSets(
    sections,
    products,
  );

  return (
    <div>
      {on("hero") && (
        <section className="luxury-hero">
          <Image
            src={heroBanner?.image ?? hero.image}
            alt=""
            fill
            priority
            className="object-cover"
            sizes="100vw"
          />
          <div className="luxury-hero__veil" aria-hidden />
          <div className="luxury-hero__content mx-auto max-w-7xl">
            <Reveal>
              <p className="section-kicker section-kicker--dark">Timeless jewellery</p>
              <div className="gold-rule mt-4" />
              <h1 className="section-title section-title--hero section-title--light mt-6 max-w-3xl">
                {(heroBanner?.title ?? hero.title).replace("\n", " ")}
              </h1>
              <p className="prose-calm prose-calm--light mt-5 max-w-lg">
                {heroBanner?.description ?? hero.subtitle}
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <Link href={heroBanner?.href ?? "/shop"} className="btn-primary">
                  {heroBanner?.cta ?? hero.cta}
                </Link>
                <Link href="/visit" className="btn-ghost">
                  Book a private viewing
                </Link>
              </div>
              <p className="prose-calm prose-calm--inline mt-10 text-[rgba(250,246,238,0.65)]">
                Hallmarked gold · Insured shipping · Atelier care in Bengaluru
              </p>
            </Reveal>
          </div>
        </section>
      )}

      {stripBanners.length > 0 ? (
        <div className="space-y-0">
          {stripBanners.map((strip) => (
            <Link
              key={strip.id}
              href={strip.href || "/shop"}
              className="luxury-marquee block transition hover:opacity-90"
            >
              {strip.title}
              {strip.description ? ` · ${strip.description}` : ""}
              {strip.cta ? ` · ${strip.cta}` : ""}
            </Link>
          ))}
        </div>
      ) : (
        <div className="luxury-marquee">
          Complimentary shipping above ₹7,999 · Private viewings by appointment
        </div>
      )}

      {on("collections") && (
        <section className="luxury-section mx-auto max-w-7xl px-4 lg:px-6">
          <Reveal>
            <div className="max-w-xl">
              <p className="section-kicker">Collections</p>
              <div className="gold-rule mt-3" />
              <h2 className="section-title mt-4">Curated for the season</h2>
              <p className="prose-calm mt-4">
                Each collection is composed like a chapter — metal, light, and silhouette in quiet balance.
              </p>
            </div>
          </Reveal>
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-7">
            {collections.slice(0, 3).map((c, i) => (
              <Reveal key={c.slug} delay={i * 120}>
                <Link href={`/collections/${c.slug}`} className="luxury-collection-tile group block">
                  <Image
                    src={c.image}
                    alt={c.name}
                    fill
                    className="object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.06]"
                    sizes="(max-width: 1024px) 50vw, 33vw"
                  />
                  <div className="luxury-collection-tile__veil" />
                  <span className="luxury-collection-tile__frame" aria-hidden />
                  <div className="luxury-collection-tile__copy">
                    <p className="luxury-collection-tile__kicker">Collection</p>
                    <span className="luxury-collection-tile__rule" aria-hidden />
                    <p className="luxury-collection-tile__name">{c.name}</p>
                    <p className="luxury-collection-tile__tagline">{c.tagline}</p>
                    <span className="luxury-collection-tile__cta">Explore collection</span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {on("bestsellers") && (
        <section className="luxury-section border-t border-[rgba(100,30,22,0.08)] bg-[rgba(255,255,255,0.25)]">
          <div className="mx-auto max-w-7xl px-4 lg:px-6">
            <Reveal>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="section-kicker">Signature pieces</p>
                  <div className="gold-rule mt-3" />
                  <h2 className="section-title mt-4">The edit</h2>
                </div>
                <Link href="/shop?sort=best" className="btn-outline">
                  View all
                </Link>
              </div>
            </Reveal>

            {!hydrated ? (
              <div className="mt-8 grid animate-pulse grid-cols-2 gap-4 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="aspect-square bg-white/40" />
                ))}
              </div>
            ) : heroProduct ? (
              <div className="mt-8 grid grid-cols-2 items-stretch gap-x-4 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:gap-x-6 xl:grid-cols-4">
                {[heroProduct, ...sideProducts].map((p, i) => (
                  <Reveal key={p.id} delay={i * 80}>
                    <ProductCard product={p} />
                  </Reveal>
                ))}
              </div>
            ) : (
              <p className="mt-12 text-sm text-ink-soft">Bestsellers will appear here once products are marked in admin.</p>
            )}
          </div>
        </section>
      )}

      {on("campaign") &&
        promoBlocks.map((promoBlock, index) => (
          <section
            key={promoBlock.id}
            className={`luxury-section mx-auto max-w-7xl px-4 lg:px-6 ${index > 0 ? "pt-0" : ""}`}
          >
            <div className="shadow-lift grid overflow-hidden md:grid-cols-2">
              <div className={`relative min-h-[280px] ${index % 2 === 1 ? "md:order-2" : ""}`}>
                <Image
                  src={promoBlock.image}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
              </div>
              <div className="flex flex-col justify-center bg-paper/80 p-6 md:p-10">
                <Reveal>
                  <p className="section-kicker">Offer</p>
                  <div className="gold-rule mt-3" />
                  <h2 className="section-title mt-4">{promoBlock.title}</h2>
                  <p className="prose-calm mt-4">{promoBlock.body}</p>
                  <Link href={promoBlock.href} className="btn-primary mt-8 inline-flex">
                    {promoBlock.cta}
                  </Link>
                </Reveal>
              </div>
            </div>
          </section>
        ))}

      <section className="luxury-section mx-auto max-w-7xl px-4 lg:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <div className="shadow-lift relative aspect-[4/5] overflow-hidden">
              <Image src="/products/life-2.jpg" alt="" fill className="object-cover" sizes="(max-width: 1024px) 100vw, 50vw" />
            </div>
          </Reveal>
          <Reveal delay={200}>
            <p className="section-kicker">The atelier</p>
            <div className="gold-rule mt-3" />
            <h2 className="section-title mt-4">Crafted in Bengaluru</h2>
            <p className="prose-calm mt-5">
              Every piece passes through our Walton Road atelier — inspected, hallmarked, and prepared for insured
              delivery. We believe luxury is not loud; it is the weight of gold in your palm and the quiet confidence of
              knowing its origin.
            </p>
            <p className="prose-calm prose-calm--inline mt-6">
              BIS hallmarked · IGI certified diamonds · 15-day exchange on eligible pieces
            </p>
            <Link href="/visit" className="btn-primary mt-8 inline-flex">
              Reserve a viewing
            </Link>
          </Reveal>
        </div>
      </section>

      {on("arrivals") && gridProducts.length > 0 && (
        <section className="luxury-section border-t border-[rgba(100,30,22,0.08)]">
          <div className="mx-auto max-w-7xl px-4 lg:px-6">
            <Reveal>
              <p className="section-kicker">New arrivals</p>
              <div className="gold-rule mt-3" />
              <h2 className="section-title mt-4">Fresh from the bench</h2>
            </Reveal>
            <div className="mt-8 grid grid-cols-2 items-stretch gap-x-4 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:gap-x-6">
              {gridProducts.map((p, i) => (
                <Reveal key={p.id} delay={i * 80}>
                  <ProductCard product={p} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {on("trust") && (
        <section className="bg-[rgba(100,30,22,0.04)] py-[clamp(3rem,7vw,5rem)]">
          <Reveal>
            <div className="mx-auto max-w-2xl px-4 text-center lg:px-6">
              <p className="section-kicker">Avyora maison</p>
              <div className="gold-rule mx-auto mt-3" />
              <h2 className="section-title mt-4">Experience jewellery in person</h2>
              <p className="prose-calm mx-auto mt-4">
                Private appointments, Tuesday through Sunday. Try solitaires, discuss bridal sets, or bring a cherished
                piece for care.
              </p>
              <p className="prose-calm prose-calm--inline mx-auto mt-4">
                Certified jewellery · Easy exchange · Safe delivery across India
              </p>
              <Link href="/visit" className="btn-primary mt-8 inline-flex">
                Book a private viewing
              </Link>
            </div>
          </Reveal>
        </section>
      )}

      {on("featured") && (
        <PersonalizedRecommendations
          context="HOME"
          kicker="Picked for you"
          title="Curated for your taste"
          className="mx-auto max-w-7xl px-4 pt-[clamp(3rem,6vw,4.5rem)] pb-2 lg:px-6"
          limit={4}
        />
      )}

      <section className="border-t border-[rgba(100,30,22,0.12)] bg-[rgba(100,30,22,0.06)] px-4 py-6 text-center lg:px-6">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 sm:flex-row sm:justify-between sm:gap-6 sm:text-left">
          <div>
            <p className="section-kicker">Still deciding</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft md:text-[15px]">
              Visit the Bengaluru atelier, or write to care for sizing and bridal advice.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2.5">
            <Link href="/visit" className="btn-primary">
              Book a viewing
            </Link>
            <Link href="/shop" className="btn-outline">
              Continue shopping
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

import Link from "next/link";

export default function CarePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20">
      <h1 className="font-serif text-5xl">Care</h1>
      <div className="mt-8 space-y-5 text-sm leading-7 text-ink-soft">
        <p>Wipe gold and platinum with a soft cloth after wear. Store each piece in its pouch so stones do not graze metal.</p>
        <p>Keep pearls away from perfume and hairspray. Silver may oxidise; a jewellery cloth restores the finish.</p>
        <p>Avoid chlorinated water, gym equipment and abrasive pastes. Complimentary professional cleaning is included with an atelier booking.</p>
        <Link href="/visit" className="btn-primary mt-4 inline-flex">
          Book a cleaning visit
        </Link>
      </div>
    </div>
  );
}

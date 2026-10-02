export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-28 text-center">
      <p className="text-[11px] tracking-[0.24em] uppercase text-gold-deep">404</p>
      <h1 className="mt-3 text-5xl font-medium tracking-tight">This page is not in the maison</h1>
      <a href="/shop" className="mt-8 inline-block text-[11px] tracking-[0.2em] uppercase underline">
        Shop jewellery
      </a>
    </div>
  );
}

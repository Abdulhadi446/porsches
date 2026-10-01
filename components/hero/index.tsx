/** STUB — owned by 3D-HERO subagent (full-screen R3F scene lives in components/hero). */
export function Hero3D() {
  return (
    <section
      className="relative flex h-dvh items-end overflow-hidden bg-ink px-[--gutter] pb-[--gutter]"
      data-owner="3d-hero"
      aria-label="Hero"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/_placeholder/911-silhouette.svg"
        alt="Porsche 911 silhouette"
        className="absolute inset-0 h-full w-full object-cover opacity-40"
      />
      <div className="relative z-content">
        <p className="label mb-4">Unofficial fan showcase · 1963 → 2026</p>
        <h1 className="text-display-1">
          Six decades
          <br />
          of the <span className="text-guards">911</span>
        </h1>
      </div>
    </section>
  );
}

import type { NextConfig } from "next";

/**
 * The R2 media origin (e.g. `https://media.example.com`), derived from the same
 * env var `mediaSrc()` uses in lib/assets.ts so the two can never disagree. An
 * unset or non-https value yields no extra pattern, leaving the committed
 * placeholder path as the only image source.
 */
const mediaHost = process.env.NEXT_PUBLIC_MEDIA_HOST ?? "";
const mediaPattern = /^https:\/\/[^/]+/.exec(mediaHost)?.[0];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Inline the route CSS instead of shipping a render-blocking stylesheet:
    // measured FCP 2044 -> 1036 ms on /compare, 2356 -> 1032 ms on a variant
    // page (docs/perf.md P2-3).
    inlineCss: true,
    // Keeps framer-motion/gsap/three addons out of the shared chunk so the first
    // route only ships the pieces it actually renders (measured: -236 kB entry).
    optimizePackageImports: [
      "framer-motion",
      "gsap",
      "@react-three/drei",
      "@react-three/postprocessing",
    ],
  },
  images: {
    formats: ["image/avif", "image/webp"],
    qualities: [70, 75, 82, 90],
    // our own /public/images/_placeholder/*.svg fallbacks
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com", pathname: "/vi/**" },
      // Cloudflare R2 media origin, when NEXT_PUBLIC_MEDIA_HOST is set.
      ...(mediaPattern
        ? [{ protocol: "https" as const, hostname: new URL(mediaPattern).hostname, pathname: "/**" }]
        : []),
    ],
    deviceSizes: [360, 640, 828, 1080, 1280, 1600, 1920, 2560],
    imageSizes: [96, 160, 256, 384],
  },
  // Media in /public is pre-converted (AVIF/WebP) by scripts; keep default caching.
  async headers() {
    return [
      {
        source: "/models/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/images/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/turntables/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
    ];
  },
};

export default nextConfig;

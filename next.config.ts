import type { NextConfig } from "next";

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
    ];
  },
};

export default nextConfig;

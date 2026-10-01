import type { Metadata, Viewport } from "next";
import { Anton, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SiteNav } from "#components/nav/site-nav";
import { PageTransition } from "#components/nav/page-transition";
import { Footer } from "#components/nav/footer";

const anton = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-anton",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://911-showcase.example.com"),
  title: {
    default: "SIX DECADES OF THE 911 — an unofficial Porsche 911 showcase",
    template: "%s — 911 Showcase",
  },
  description:
    "An unofficial, fan-made cinematic showcase of every Porsche 911 generation and variant, from the 1963 901 to the 992.2 T-Hybrid era.",
  openGraph: {
    type: "website",
    title: "SIX DECADES OF THE 911",
    description:
      "Every generation, every variant — 1963 to today. Unofficial fan project.",
  },
};

export const viewport: Viewport = {
  themeColor: "#050506",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${anton.variable} ${jetbrains.variable} ${inter.variable}`}
    >
      <body className="grain min-h-dvh bg-ink text-metal-100 antialiased">
        <PageTransition>
          <SiteNav />
          <main id="main">{children}</main>
          <Footer />
        </PageTransition>
      </body>
    </html>
  );
}

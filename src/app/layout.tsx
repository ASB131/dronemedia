import type { Metadata, Viewport } from "next";
import { Overpass, Overpass_Mono } from "next/font/google";
import Script from "next/script";

import { loadConfig } from "@/lib/config";

import "./globals.css";

const overpass = Overpass({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const overpassMono = Overpass_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Drone Media",
  description:
    "Self-hosted drone media management — videos, photos, and flight telemetry",
  applicationName: "Drone Media",
  appleWebApp: {
    capable: true,
    title: "Drone Media",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

function hexToRgbChannels(hex: string): string {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `${r} ${g} ${b}`;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let accent = "#4250AF";
  try {
    accent = loadConfig().theme.accent ?? accent;
  } catch {
    // Config may be unavailable during some build paths
  }
  const accentRgb = hexToRgbChannels(accent);

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${overpass.variable} ${overpassMono.variable} h-full antialiased`}
      style={
        {
          "--immich-primary": accentRgb,
        } as React.CSSProperties
      }
    >
      <body className="min-h-full font-sans">
        <Script
          id="dm-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('dm-theme');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;if(d)r.classList.add('dark');else r.classList.remove('dark');r.style.colorScheme=d?'dark':'light';}catch(e){}})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}

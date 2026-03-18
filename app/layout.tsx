// app/layout.tsx
import type { Metadata } from "next";
import { Barlow_Condensed, IBM_Plex_Mono, Barlow } from "next/font/google";
import "./globals.css";

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-display",
});

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Bracket Tracker — 2026 March Madness",
  description: "Live tracking of 5 million ML-generated March Madness brackets",
  openGraph: {
    title: "Bracket Tracker — 2026 March Madness",
    description: "Live tracking of 5 million ML-generated March Madness brackets",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlowCondensed.variable} ${barlow.variable} ${ibmPlexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

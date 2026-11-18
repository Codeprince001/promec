import type { Metadata } from "next";
import { Barlow_Condensed, Geist } from "next/font/google";
import { Providers } from "@/components/providers";
import { Shell } from "@/components/shell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const display = Barlow_Condensed({
  variable: "--font-promec-display",
  subsets: ["latin"],
  weight: ["600", "700"],
  style: ["italic"],
});

export const metadata: Metadata = {
  title: "PROMEC",
  description: "Automotive parts from PROMEC Limited and approved stores",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}

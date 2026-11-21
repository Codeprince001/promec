import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import { Shell } from "@/components/shell";
import "./globals.css";

const themeBoot = `(function(){try{var t=localStorage.getItem('promec-theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})();`;

const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const display = localFont({
  src: [
    {
      path: "./fonts/barlow-600-italic.woff2",
      weight: "600",
      style: "italic",
    },
    {
      path: "./fonts/barlow-700-italic.woff2",
      weight: "700",
      style: "italic",
    },
  ],
  variable: "--font-promec-display",
});

export const metadata: Metadata = {
  title: "PROMEC",
  description: "Automotive parts from PROMEC Limited and approved stores",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${display.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}

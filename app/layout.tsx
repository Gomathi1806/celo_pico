import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getAppUrl } from "@/lib/app-url";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const APP_URL = getAppUrl();

export const metadata: Metadata = {
  title: "pico — pennies of AI, settled inline",
  description:
    "Pico is a MiniPay Mini App that runs AI tools (image, scrape, ask, summarize) and charges a few cents of cUSD per call over the x402 protocol on Celo.",
  metadataBase: new URL(APP_URL),
  openGraph: {
    title: "pico — pennies of AI, settled inline",
    description: "Pay-per-use AI tools, settled in cUSD over x402 on Celo.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="bg-background text-foreground min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}

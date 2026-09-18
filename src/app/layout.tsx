import type { Metadata, Viewport } from "next";
import { Sora, Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { PWARegister } from "@/components/df/pwa";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DukaFlow - Kenya Retail ERP + POS",
  description:
    "Offline-first multi-store POS, loyalty, gift cards, debt plans, KRA eTIMS, M-Pesa, Kenya-compliant payroll and Raven chat - built for Kenyan hardware stores and supermarkets.",
  keywords: ["POS Kenya", "eTIMS", "M-Pesa", "ERP", "hardware store", "loyalty", "payroll"],
  icons: { icon: "/favicon.svg", apple: "/icons/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "DukaFlow",
  },
  applicationName: "DukaFlow",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0052CC",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${sora.variable} ${inter.variable} antialiased bg-background text-foreground font-inter`}
      >
        {children}
        <PWARegister />
        <Toaster />
      </body>
    </html>
  );
}

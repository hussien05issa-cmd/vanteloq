import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./operating.css";
import "./bookloq.css";
import "./governance.css";
import "./billing.css";
import "./control.css";
import "./theme.css";
import "./readability.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vanteloq · Business Operating System",
  description: "A retail operating system that brings sales, cash, inventory and daily work into one clear, controlled view.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: { url: "/brand/vanteloq-mark.png", type: "image/png" },
    shortcut: "/brand/vanteloq-mark.png",
    apple: "/brand/vanteloq-mark.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

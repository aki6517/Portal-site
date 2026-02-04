import type { Metadata } from "next";
import {
  Dela_Gothic_One,
  Geist_Mono,
  M_PLUS_Rounded_1c,
  Zen_Kaku_Gothic_New,
} from "next/font/google";
import Link from "next/link";
import "./globals.css";
import SiteHeader from "./_components/SiteHeader";

const zenSans = Zen_Kaku_Gothic_New({
  variable: "--font-zen-sans",
  weight: ["400", "500", "700", "900"],
  subsets: ["latin"],
  display: "swap",
});

const delaDisplay = Dela_Gothic_One({
  variable: "--font-dela-display",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const rounded = M_PLUS_Rounded_1c({
  variable: "--font-rounded",
  weight: ["400", "500", "700", "800"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "福岡アクトポータル - 福岡演劇公演ポータル",
  description:
    "福岡の演劇公演情報を一元管理。今の気分で公演を探せるポータルサイト。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${zenSans.variable} ${delaDisplay.variable} ${geistMono.variable} ${rounded.variable} antialiased`}
      >
        <div className="min-h-screen text-ink">
          <SiteHeader />
          <main className="pt-20 md:pt-24">{children}</main>
          <footer className="mt-16 border-t-4 border-ink bg-ink text-white">
            <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-xs sm:flex-row sm:items-center sm:justify-between">
              <span className="opacity-90">© 2026 福岡アクトポータル</span>
              <div className="flex items-center gap-4">
                <Link href="/about" className="opacity-90 hover:opacity-100">
                  運営者情報
                </Link>
                <Link
                  href="/privacy-policy"
                  className="opacity-90 hover:opacity-100"
                >
                  プライバシーポリシー
                </Link>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}

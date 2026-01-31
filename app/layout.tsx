import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="min-h-screen bg-white text-zinc-900">
          <header className="border-b border-zinc-200">
            <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
              <Link href="/" className="text-sm font-bold tracking-wide">
                福岡アクトポータル
              </Link>
              <nav className="flex items-center gap-4 text-sm">
                <Link href="/events" className="hover:underline">
                  公演を探す
                </Link>
                <Link href="/blog" className="hover:underline">
                  ブログ
                </Link>
                <Link href="/register" className="hover:underline">
                  劇団の方へ
                </Link>
                <Link href="/admin/contact" className="hover:underline">
                  管理者
                </Link>
              </nav>
            </div>
          </header>
          <main>{children}</main>
          <footer className="border-t border-zinc-200">
            <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 text-xs text-zinc-600">
              <span>© 2026 福岡アクトポータル</span>
              <div className="flex items-center gap-4">
                <Link href="/about" className="hover:underline">
                  運営者情報
                </Link>
                <Link href="/privacy-policy" className="hover:underline">
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

"use client";

import Link from "next/link";
import { Menu, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";

const navItems = [
  { label: "公演を探す", href: "/events" },
  { label: "劇団の方へ", href: "/register" },
  { label: "特集記事", href: "/blog" },
  { label: "管理者", href: "/admin/contact" },
];

export default function SiteHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    handleScroll();
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? "bg-[rgba(246,246,248,0.9)] backdrop-blur-md shadow-hard-sm border-b-2 border-ink py-3"
          : "bg-transparent py-4 md:py-6"
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 md:px-6">
        <Link
          href="/"
          className="group flex items-center gap-2"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div className="rounded-full border-2 border-ink bg-ink p-1 text-pop-yellow transition-colors group-hover:bg-pop-pink group-hover:text-white">
            <Zap size={20} fill="currentColor" />
          </div>
          <span className="logo-mark text-xl leading-none sm:text-2xl md:text-3xl">
            福岡アクトポータル
          </span>
        </Link>

        <nav className="font-rounded hidden items-center rounded-full border-2 border-ink bg-white px-6 py-2 text-sm font-bold text-ink shadow-hard-sm md:flex">
          {navItems.map((item, index) => (
            <div key={item.href} className="flex items-center gap-4">
              <Link
                href={item.href}
                className="transition-colors hover:text-pop-pink"
              >
                {item.label}
              </Link>
              {index !== navItems.length - 1 && (
                <div className="h-1 w-1 rounded-full bg-ink" />
              )}
            </div>
          ))}
        </nav>

        <button
          type="button"
          className="rounded-lg border-2 border-ink bg-white p-2 text-ink shadow-hard-sm active:translate-y-1 active:shadow-none md:hidden"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          aria-label="Menu"
        >
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {mobileMenuOpen && (
        <div className="font-rounded mx-4 mt-3 rounded-2xl border-2 border-ink bg-white p-4 text-sm font-bold text-ink shadow-hard-sm md:hidden">
          <nav className="flex flex-col gap-3">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="transition-colors hover:text-pop-pink"
                onClick={() => setMobileMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}

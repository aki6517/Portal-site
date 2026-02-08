"use client";

import { useEffect } from "react";

type Props = {
  category: string;
  slug: string;
};

const getJstDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const buildCookieKey = (category: string, slug: string) =>
  `viewed_${category}_${slug}`.replace(/[^a-zA-Z0-9_-]/g, "_");

const getCookieValue = (key: string) => {
  const prefix = `${key}=`;
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
};

export default function ViewCounter({ category, slug }: Props) {
  useEffect(() => {
    const key = buildCookieKey(category, slug);
    const today = getJstDate();
    const viewedToday = getCookieValue(key) === today;
    if (viewedToday) return;

    fetch("/api/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, slug }),
    })
      .then((res) => {
        if (!res.ok) return;
        document.cookie = `${key}=${today}; Path=/; Max-Age=86400; SameSite=Lax`;
      })
      .catch(() => undefined);
  }, [category, slug]);

  return null;
}

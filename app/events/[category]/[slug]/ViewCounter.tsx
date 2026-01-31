"use client";

import { useEffect } from "react";

type Props = {
  category: string;
  slug: string;
};

export default function ViewCounter({ category, slug }: Props) {
  useEffect(() => {
    fetch("/api/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, slug }),
    }).catch(() => undefined);
  }, [category, slug]);

  return null;
}

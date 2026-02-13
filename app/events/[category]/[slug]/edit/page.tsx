"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import EditEventScreen from "@/app/theater/events/_components/EditEventScreen";

type TheaterEvent = {
  id: string;
  category: string;
  categories?: string[] | null;
  slug: string;
};

const pickParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const decodeRouteParam = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export default function EventEditBySlugPage() {
  const params = useParams<{ category: string | string[]; slug: string | string[] }>();
  const category = useMemo(
    () => decodeRouteParam(pickParam(params?.category) ?? ""),
    [params]
  );
  const slug = useMemo(
    () => decodeRouteParam(pickParam(params?.slug) ?? ""),
    [params]
  );

  const [eventId, setEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!category || !slug) {
      setLoading(false);
      setMessage("URLが不正です。");
      return;
    }

    let disposed = false;
    const load = async () => {
      setLoading(true);
      setMessage(null);
      const res = await fetch("/api/theater/events", { cache: "no-store" });
      if (disposed) return;

      if (res.status === 401) {
        setMessage("ログインが必要です。");
        setLoading(false);
        return;
      }

      if (res.status === 403) {
        setMessage("この公演を編集する権限がありません。");
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setMessage("公演情報の取得に失敗しました。");
        setLoading(false);
        return;
      }

      const json = (await res.json()) as { data?: { events?: TheaterEvent[] } };
      const events = json.data?.events ?? [];
      const matched = events.find(
        (event) =>
          event.slug === slug &&
          (event.category === category ||
            (Array.isArray(event.categories) && event.categories.includes(category)))
      );

      if (!matched) {
        setMessage("対象公演が見つかりません。");
        setLoading(false);
        return;
      }

      setEventId(matched.id);
      setLoading(false);
    };

    void load();
    return () => {
      disposed = true;
    };
  }, [category, slug]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="card-retro p-6 text-sm text-zinc-700">読み込み中...</div>
      </div>
    );
  }

  if (!eventId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="card-retro p-6 text-sm text-zinc-700">
          <p>{message ?? "この公演を編集できません。"}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/theater" className="btn-retro btn-ink">
              劇団ダッシュボードへ
            </Link>
            <Link
              href={`/events/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`}
              className="btn-retro btn-surface"
            >
              公開ページへ
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <EditEventScreen eventId={eventId} />
    </div>
  );
}

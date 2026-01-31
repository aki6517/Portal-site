"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type MeData = {
  theater: { id: string; name: string; status: string } | null;
  member: { role: string } | null;
};

type EventRow = {
  id: string;
  title: string;
  category: string;
  slug: string;
  status: string;
  start_date: string;
};

export default function TheaterDashboardPage() {
  const [me, setMe] = useState<MeData | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const res = await fetch("/api/theater/me", { cache: "no-store" });
      if (res.status === 401) {
        setError("ログインが必要です。");
        setLoading(false);
        return;
      }
      const json = (await res.json()) as { data?: MeData };
      setMe(json.data ?? null);

      const eventsRes = await fetch("/api/theater/events", {
        cache: "no-store",
      });
      if (eventsRes.ok) {
        const eventsJson = (await eventsRes.json()) as {
          data?: { events: EventRow[] };
        };
        setEvents(eventsJson.data?.events ?? []);
      }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading) {
    return <div className="text-sm text-zinc-600">読み込み中...</div>;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-zinc-200 p-6 text-sm">
        {error} <Link href="/register">/register</Link>
      </div>
    );
  }

  if (!me?.theater) {
    return (
      <div className="rounded-xl border border-zinc-200 p-6 text-sm">
        劇団情報が未登録です。<Link href="/register">/register</Link>{" "}
        から登録してください。
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {me.theater.status !== "approved" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          劇団は現在「{me.theater.status}」です。公開はできませんが下書きの作成・編集は可能です。
        </div>
      )}
      <div className="rounded-xl border border-zinc-200 p-6">
        <h2 className="text-lg font-semibold">ダッシュボード</h2>
        <p className="mt-2 text-sm text-zinc-600">
          公演の作成・編集・非公開・削除ができます。
        </p>
        <Link
          className="mt-4 inline-block rounded-md border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm text-white"
          href="/theater/events/new"
        >
          新規公演を作成
        </Link>
      </div>

      <div className="rounded-xl border border-zinc-200 p-6">
        <h3 className="text-base font-semibold">公演一覧</h3>
        <div className="mt-4 space-y-3 text-sm">
          {events.length === 0 && (
            <div className="text-zinc-600">公演がまだありません。</div>
          )}
          {events.map((event) => (
            <div
              key={event.id}
              className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2"
            >
              <div>
                <div className="font-medium">{event.title}</div>
                <div className="text-xs text-zinc-500">
                  {event.category} / {event.slug} / {event.status}
                </div>
              </div>
              <Link
                href={`/theater/events/${event.id}`}
                className="text-xs text-zinc-900 underline"
              >
                編集
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

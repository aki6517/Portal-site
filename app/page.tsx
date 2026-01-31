import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type TrendingEvent = {
  id: string;
  title: string;
  category: string;
  slug: string;
  start_date: string;
};

const formatDate = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
  }).format(date);
};

const getTrendingEvents = async () => {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const service = createSupabaseServiceClient();
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const sinceDate = since.toISOString().slice(0, 10);
    const { data: views } = await service
      .from("event_views_daily")
      .select("event_id, views")
      .gte("view_date", sinceDate);
    const map = new Map<string, number>();
    (views ?? []).forEach((row) => {
      const total = map.get(row.event_id) ?? 0;
      map.set(row.event_id, total + (row.views ?? 0));
    });
    const ranked = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const ids = ranked.map(([id]) => id);
    if (ids.length === 0) return [];
    const { data: events } = await service
      .from("events")
      .select("id, title, category, slug, start_date")
      .eq("status", "published")
      .in("id", ids);
    const byId = new Map(events?.map((event) => [event.id, event]) ?? []);
    return ranked
      .map(([id]) => byId.get(id))
      .filter(Boolean) as TrendingEvent[];
  }

  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("events")
    .select("id, title, category, slug, start_date")
    .eq("status", "published")
    .order("start_date", { ascending: true })
    .limit(3);
  return (data ?? []) as TrendingEvent[];
};

export default async function Home() {
  const trending = await getTrendingEvents();
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-8">
        <h1 className="text-3xl font-bold">福岡アクトポータル</h1>
        <p className="mt-3 text-sm text-zinc-600">
          福岡の演劇公演を「今の気分」で探せるポータルサイト。
        </p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <Link
            href="/events"
            className="rounded-full border border-zinc-900 px-4 py-2 font-medium hover:bg-zinc-900 hover:text-white"
          >
            公演を探す
          </Link>
          <Link
            href="/calendar"
            className="rounded-full border border-zinc-200 px-4 py-2 hover:bg-white"
          >
            カレンダー
          </Link>
          <Link
            href="/blog"
            className="rounded-full border border-zinc-200 px-4 py-2 hover:bg-white"
          >
            ブログ
          </Link>
        </div>
      </section>

      <section className="mt-10 grid gap-6 md:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 p-6">
          <h2 className="text-lg font-semibold">今の気分で選ぶ</h2>
          <p className="mt-2 text-sm text-zinc-600">
            笑い / 感動 / 思考 から公演を探す導線を実装予定。
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 p-6">
          <h2 className="text-lg font-semibold">注目の公演</h2>
          <p className="mt-2 text-sm text-zinc-600">
            運営者がピックアップする3公演を表示予定。
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 p-6">
          <h2 className="text-lg font-semibold">TRENDING</h2>
          {trending.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">
              直近30日PV上位の公演を表示します。
            </p>
          ) : (
            <div className="mt-3 space-y-3 text-sm">
              {trending.map((event) => (
                <Link
                  key={event.id}
                  href={`/events/${event.category}/${event.slug}`}
                  className="block rounded-md border border-zinc-200 px-3 py-2 hover:border-zinc-900"
                >
                  <div className="font-medium">{event.title}</div>
                  <div className="text-xs text-zinc-500">
                    {formatDate(event.start_date)}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

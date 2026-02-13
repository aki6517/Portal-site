import Image from "next/image";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { buildIlikeFilter } from "@/lib/search";
import { buildMetadata } from "@/lib/seo";

type EventRecord = {
  id: string;
  title: string;
  category: string;
  categories?: string[] | null;
  slug: string;
  start_date: string;
  end_date?: string | null;
  venue?: string | null;
  image_url?: string | null;
  flyer_url?: string | null;
  company?: string | null;
  publish_at?: string | null;
};

const formatDate = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  });
  return formatter.format(date);
};

const normalizeQuery = (value?: string) => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 80);
};

const isReleased = (publishAt?: string | null) => {
  if (!publishAt) return true;
  const date = new Date(publishAt);
  if (Number.isNaN(date.getTime())) return true;
  return date.getTime() <= Date.now();
};

const getCategories = async () => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("categories")
    .select("id, name, icon, color")
    .order("sort_order", { ascending: true });
  return data ?? [];
};

const getEvents = async (query?: string) => {
  const supabase = await createSupabaseServerClient();
  let request = supabase
    .from("events")
    .select(
      "id, title, category, categories, slug, start_date, end_date, venue, image_url, flyer_url, company, publish_at"
    )
    .eq("status", "published");

  if (query) {
    const filter = buildIlikeFilter(query, ["title", "venue", "company"]);
    if (filter) {
      request = request.or(filter);
    }
  }

  const { data, error } = await request.order("start_date", { ascending: true });
  let rows = (data ?? []) as EventRecord[];
  const missingColumns =
    !!error &&
    (error.message.includes("column") || error.message.includes("does not exist"));
  if (missingColumns) {
    let fallback = supabase
      .from("events")
      .select(
        "id, title, category, categories, slug, start_date, end_date, venue, image_url, flyer_url, company"
      )
      .eq("status", "published");
    if (query) {
      const filter = buildIlikeFilter(query, ["title", "venue", "company"]);
      if (filter) {
        fallback = fallback.or(filter);
      }
    }
    const fallbackRes = await fallback.order("start_date", { ascending: true });
    rows = (fallbackRes.data ?? []) as EventRecord[];
  }

  return rows.filter((event) => isReleased(event.publish_at));
};

const getViews30Map = async () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new Map<string, number>();
  const service = createSupabaseServiceClient();
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceDate = since.toISOString().slice(0, 10);
  const { data } = await service
    .from("event_views_daily")
    .select("event_id, views")
    .gte("view_date", sinceDate);
  const map = new Map<string, number>();
  (data ?? []).forEach((row) => {
    const total = map.get(row.event_id) ?? 0;
    map.set(row.event_id, total + (row.views ?? 0));
  });
  return map;
};

export async function generateMetadata() {
  return buildMetadata({
    title: "公演一覧",
    description: "福岡の公演情報を開催日順・人気順で検索できます。",
    path: "/events",
  });
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams?: { sort?: string; q?: string } | Promise<{ sort?: string; q?: string }>;
}) {
  const resolvedSearchParams = await Promise.resolve(searchParams);
  const sort = resolvedSearchParams?.sort === "popular" ? "popular" : "date";
  const q = normalizeQuery(resolvedSearchParams?.q);
  const [categories, events, viewsMap] = await Promise.all([
    getCategories(),
    getEvents(q),
    sort === "popular" ? getViews30Map() : Promise.resolve(new Map()),
  ]);

  const sortedEvents =
    sort === "popular"
      ? [...events].sort((a, b) => {
          const aViews = viewsMap.get(a.id) ?? 0;
          const bViews = viewsMap.get(b.id) ?? 0;
          if (bViews !== aViews) return bViews - aViews;
          return a.start_date.localeCompare(b.start_date);
        })
      : events;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-tight">公演一覧</h1>
          <p className="mt-2 text-sm text-zinc-700">
            開催日順／人気順（直近30日PV）で並べ替えできます。
          </p>
        </div>
        <form action="/events" method="get" className="flex w-full gap-3 md:max-w-md">
          <input
            name="q"
            defaultValue={q}
            placeholder="キーワード（公演名・会場）"
            className="input-retro"
          />
          <input type="hidden" name="sort" value={sort} />
          <button type="submit" className="btn-retro btn-ink">
            検索
          </button>
        </form>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 text-sm">
        <Link
          href={`/events?sort=date${q ? `&q=${encodeURIComponent(q)}` : ""}`}
          className={`btn-retro ${
            sort === "date" ? "btn-ink" : "btn-surface"
          }`}
        >
          開催日順
        </Link>
        <Link
          href={`/events?sort=popular${q ? `&q=${encodeURIComponent(q)}` : ""}`}
          className={`btn-retro ${
            sort === "popular" ? "btn-ink" : "btn-surface"
          }`}
        >
          人気順（30日PV）
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {categories.map((category) => (
          <Link
            key={category.id}
            href={`/events/${category.id}`}
            className="badge-retro bg-surface shadow-hard-sm"
          >
            <span aria-hidden>{category.icon ?? "🎭"}</span>
            <span>{category.name}</span>
          </Link>
        ))}
      </div>

      <div className="mt-8 grid gap-4">
        {sortedEvents.length === 0 && (
          <div className="rounded-2xl border-2 border-ink bg-surface p-6 text-sm text-zinc-700 shadow-hard-sm">
            {q
              ? `「${q}」に一致する公演は見つかりませんでした。`
              : "公開中の公演はありません。"}
          </div>
        )}
        {sortedEvents.map((event) => {
          const image = event.image_url || event.flyer_url;
          const views = viewsMap.get(event.id) ?? 0;
          return (
            <div key={event.id} className="card-retro p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <Link
                    href={`/events/${event.category}/${event.slug}`}
                    className="text-lg font-black hover:underline"
                  >
                    {event.title}
                  </Link>
                  <div className="mt-1 text-xs text-zinc-600">
                    {formatDate(event.start_date)}
                    {event.end_date ? ` 〜 ${formatDate(event.end_date)}` : ""}
                  </div>
                  {event.venue && (
                    <div className="text-xs text-zinc-600">{event.venue}</div>
                  )}
                  {sort === "popular" && (
                    <div className="mt-2">
                      <span className="badge-retro bg-secondary shadow-hard-sm">
                        直近30日PV: {views}
                      </span>
                    </div>
                  )}
                </div>
                {image && (
                  <Image
                    src={image}
                    alt={event.title}
                    width={128}
                    height={80}
                    sizes="128px"
                    className="h-20 w-32 rounded-xl border-2 border-ink object-cover shadow-hard-sm"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

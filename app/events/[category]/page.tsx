import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const SITE_NAME = "福岡アクトポータル";

const formatDate = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const getCategories = async () => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("categories")
    .select("id, name, icon, color")
    .order("sort_order", { ascending: true });
  return data ?? [];
};

const getEvents = async (category: string) => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("events")
    .select(
      "id, title, category, slug, start_date, end_date, venue, image_url, flyer_url"
    )
    .eq("status", "published")
    .eq("category", category)
    .order("start_date", { ascending: true });
  return data ?? [];
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
  return {
    title: `カテゴリ別 公演一覧 | ${SITE_NAME}`,
  };
}

export default async function EventsByCategoryPage({
  params,
  searchParams,
}: {
  params: { category: string };
  searchParams?: { sort?: string };
}) {
  const sort = searchParams?.sort === "popular" ? "popular" : "date";
  const [categories, events, viewsMap] = await Promise.all([
    getCategories(),
    getEvents(params.category),
    sort === "popular" ? getViews30Map() : Promise.resolve(new Map()),
  ]);

  const category = categories.find((item) => item.id === params.category);
  if (!category) {
    notFound();
  }

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
      <h1 className="text-2xl font-bold">
        {category.icon ?? "🎭"} {category.name} の公演一覧
      </h1>
      <p className="mt-2 text-sm text-zinc-600">
        開催日順／人気順（直近30日PV）で表示します。
      </p>

      <div className="mt-6 flex flex-wrap gap-2 text-xs">
        <Link
          href={`/events/${params.category}?sort=date`}
          className={`rounded-full border px-3 py-1 ${
            sort === "date"
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-200 text-zinc-700"
          }`}
        >
          開催日順
        </Link>
        <Link
          href={`/events/${params.category}?sort=popular`}
          className={`rounded-full border px-3 py-1 ${
            sort === "popular"
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-200 text-zinc-700"
          }`}
        >
          人気順（30日PV）
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 text-xs">
        {categories.map((item) => (
          <Link
            key={item.id}
            href={`/events/${item.id}`}
            className={`rounded-full border px-3 py-1 ${
              item.id === params.category
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-200 text-zinc-700"
            }`}
          >
            {item.icon ?? "🎭"} {item.name}
          </Link>
        ))}
      </div>

      <div className="mt-8 grid gap-4">
        {sortedEvents.length === 0 && (
          <div className="text-sm text-zinc-600">公開中の公演はありません。</div>
        )}
        {sortedEvents.map((event) => {
          const image = event.flyer_url || event.image_url;
          const views = viewsMap.get(event.id) ?? 0;
          return (
            <div
              key={event.id}
              className="rounded-xl border border-zinc-200 p-4"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <Link
                    href={`/events/${event.category}/${event.slug}`}
                    className="text-base font-semibold hover:underline"
                  >
                    {event.title}
                  </Link>
                  <div className="mt-1 text-xs text-zinc-500">
                    {formatDate(event.start_date)}
                    {event.end_date ? ` 〜 ${formatDate(event.end_date)}` : ""}
                  </div>
                  {event.venue && (
                    <div className="text-xs text-zinc-500">{event.venue}</div>
                  )}
                  {sort === "popular" && (
                    <div className="mt-1 text-xs text-zinc-500">
                      直近30日PV: {views}
                    </div>
                  )}
                </div>
                {image && (
                  <Image
                    src={image}
                    alt={event.title}
                    width={128}
                    height={80}
                    unoptimized
                    className="h-20 w-32 rounded-md border border-zinc-200 object-cover"
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

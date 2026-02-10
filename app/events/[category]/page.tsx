import Image from "next/image";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { buildMetadata } from "@/lib/seo";

type CategoryRecord = {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
};

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

const decodeRouteParam = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const getCategories = async () => {
  const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();
  const { data } = await supabase
    .from("categories")
    .select("id, name, icon, color")
    .order("sort_order", { ascending: true });
  return (data ?? []) as CategoryRecord[];
};

const getEvents = async (category: string, query?: string) => {
  const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();
  const selectFields =
    "id, title, category, categories, slug, start_date, end_date, venue, image_url, flyer_url, company";
  const { data, error } = await supabase
    .from("events")
    .select(selectFields)
    .eq("status", "published")
    .order("start_date", { ascending: true });

  let rows = (data ?? []) as EventRecord[];
  const missingCategoriesColumn =
    !!error &&
    (error.message.includes("column") || error.message.includes("does not exist"));

  if (missingCategoriesColumn) {
    const fallback = await supabase
      .from("events")
      .select(
        "id, title, category, slug, start_date, end_date, venue, image_url, flyer_url, company"
      )
      .eq("status", "published")
      .order("start_date", { ascending: true });
    rows = (fallback.data ?? []) as EventRecord[];
  }

  const filtered = rows.filter(
    (event) =>
      event.category === category ||
      (Array.isArray(event.categories) && event.categories.includes(category))
  );
  if (!query) return filtered;
  const lowered = query.toLowerCase();
  return filtered.filter((event) =>
    [event.title, event.venue, event.company]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(lowered))
  );
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

export async function generateMetadata({
  params,
}: {
  params: { category: string } | Promise<{ category: string }>;
}) {
  const resolvedParams = await Promise.resolve(params);
  const categoryId = decodeRouteParam(resolvedParams.category);
  const categories = await getCategories();
  const category = categories.find((item) => item.id === categoryId);
  const title = category
    ? `${category.name}の公演`
    : "カテゴリ別 公演一覧";
  const description = category
    ? `福岡の${category.name}公演を一覧で紹介します。`
    : "福岡の公演をカテゴリ別に一覧表示します。";

  return buildMetadata({
    title,
    description,
    path: `/events/${resolvedParams.category}`,
  });
}

export default async function EventsByCategoryPage({
  params,
  searchParams,
}: {
  params: { category: string } | Promise<{ category: string }>;
  searchParams?:
    | { sort?: string; q?: string }
    | Promise<{ sort?: string; q?: string }>;
}) {
  const resolvedParams = await Promise.resolve(params);
  const categoryId = decodeRouteParam(resolvedParams.category);
  const resolvedSearchParams = await Promise.resolve(searchParams);
  const sort = resolvedSearchParams?.sort === "popular" ? "popular" : "date";
  const q = normalizeQuery(resolvedSearchParams?.q);
  const [categories, events, viewsMap] = await Promise.all([
    getCategories(),
    getEvents(categoryId, q),
    sort === "popular" ? getViews30Map() : Promise.resolve(new Map()),
  ]);

  const category = categories.find((item) => item.id === categoryId);
  const categoryName = category?.name ?? categoryId;
  const categoryIcon = category?.icon ?? "🎭";
  const hasCurrentCategory = categories.some((item) => item.id === categoryId);
  const categoryTabs = hasCurrentCategory
    ? categories
    : [{ id: categoryId, name: categoryName, icon: categoryIcon }, ...categories];

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
          <h1 className="font-display text-3xl tracking-tight">
            {categoryIcon} {categoryName} の公演
          </h1>
          <p className="mt-2 text-sm text-zinc-700">
            開催日順／人気順（直近30日PV）で並べ替えできます。
          </p>
        </div>
        <form
          action={`/events/${resolvedParams.category}`}
          method="get"
          className="flex w-full gap-3 md:max-w-md"
        >
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
          href={`/events/${resolvedParams.category}?sort=date${
            q ? `&q=${encodeURIComponent(q)}` : ""
          }`}
          className={`btn-retro ${sort === "date" ? "btn-ink" : "btn-surface"}`}
        >
          開催日順
        </Link>
        <Link
          href={`/events/${resolvedParams.category}?sort=popular${
            q ? `&q=${encodeURIComponent(q)}` : ""
          }`}
          className={`btn-retro ${
            sort === "popular" ? "btn-ink" : "btn-surface"
          }`}
        >
          人気順（30日PV）
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {categoryTabs.map((item) => (
          <Link
            key={item.id}
            href={`/events/${encodeURIComponent(item.id)}`}
            className={`badge-retro shadow-hard-sm ${
              item.id === categoryId ? "bg-primary" : "bg-surface"
            }`}
          >
            <span aria-hidden>{item.icon ?? "🎭"}</span>
            <span>{item.name}</span>
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
                    href={`/events/${encodeURIComponent(
                      event.category
                    )}/${encodeURIComponent(event.slug)}`}
                    className="text-lg font-black hover:underline"
                  >
                    {event.title}
                  </Link>
                  <div className="mt-1 text-xs text-zinc-600">
                    {formatDate(event.start_date)}
                    {event.end_date ? ` 〜 ${formatDate(event.end_date)}` : ""}
                  </div>
                  {event.venue && (
                    <div className="break-words text-xs text-zinc-600">
                      {event.venue}
                    </div>
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
                    unoptimized
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

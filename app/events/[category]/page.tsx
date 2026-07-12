import Link from "next/link";
import ImageWithFallback from "@/app/_components/ImageWithFallback";
import { buildEventImageCandidates } from "@/lib/events/image";
import {
  getCategories,
  getUpcomingEvents,
  getViews30Map,
} from "@/lib/data/events";
import { buildMetadata } from "@/lib/seo";

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

const getEventImageCandidates = (event: {
  image_url?: string | null;
  flyer_url?: string | null;
}) => buildEventImageCandidates(event.image_url, event.flyer_url);

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
    getUpcomingEvents({ category: categoryId, query: q, limit: 60 }),
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
          <h1 className="heading-ja text-3xl">
            {categoryIcon} {categoryName} の公演
          </h1>
          <p className="mt-2 text-sm text-zinc-700">
            開催日順／人気順（直近30日PV）で並べ替えできます。
          </p>
        </div>
        <form
          action={`/events/${encodeURIComponent(categoryId)}`}
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
          href={`/events/${encodeURIComponent(categoryId)}?sort=date${
            q ? `&q=${encodeURIComponent(q)}` : ""
          }`}
          className={`btn-retro ${sort === "date" ? "btn-ink" : "btn-surface"}`}
        >
          開催日順
        </Link>
        <Link
          href={`/events/${encodeURIComponent(categoryId)}?sort=popular${
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
              item.id === categoryId ? "bg-primary text-white" : "bg-surface"
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
          const imageCandidates = getEventImageCandidates(event);
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
                <ImageWithFallback
                  srcCandidates={imageCandidates}
                  alt={event.title}
                  width={128}
                  height={80}
                  sizes="128px"
                  className="h-20 w-32 rounded-xl border-2 border-ink object-cover shadow-hard-sm"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

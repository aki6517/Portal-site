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

const getEventImageCandidates = (event: {
  image_url?: string | null;
  flyer_url?: string | null;
}) => buildEventImageCandidates(event.image_url, event.flyer_url);

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
    getUpcomingEvents({ query: q, limit: 60 }),
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
          <h1 className="heading-ja text-3xl">公演一覧</h1>
          <p className="mt-2 text-sm text-zinc-700">
            開催日順／人気順（直近30日PV）で並べ替えできます。
          </p>
        </div>
        <form action="/events" method="get" className="flex w-full gap-3 md:max-w-md">
          <input
            name="q"
            defaultValue={q}
            placeholder="キーワード（公演名・会場）"
            aria-label="公演を検索"
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
            href={`/events/${encodeURIComponent(category.id)}`}
            className="badge-retro bg-surface shadow-hard-sm"
          >
            <span aria-hidden>{category.icon ?? "🎭"}</span>
            <span>{category.name}</span>
          </Link>
        ))}
        <Link
          href="/events/archive"
          className="badge-retro bg-surface-muted shadow-hard-sm"
        >
          <span aria-hidden>🗂️</span>
          <span>過去公演アーカイブ</span>
        </Link>
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

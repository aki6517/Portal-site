import Link from "next/link";
import WeekTimetable from "./WeekTimetable";
import { buildMetadata, getSiteUrl } from "@/lib/seo";
import { getUpcomingEvents } from "@/lib/data/events";
import {
  buildCalendarHref,
  getWeekTimetable,
  normalizeWeekParam,
  shiftWeekIso,
} from "@/lib/data/calendar";
import { getReadableTextColor } from "@/lib/color";

// searchParams（?week=, ?cat=）に依存する動的ページ。ただしDBフェッチ自体は
// lib/data/calendar.ts / lib/data/events.ts 側でunstable_cache+tagsされて
// いるため、force-dynamicは指定しない（Phase 1と同じ考え方）。

export async function generateMetadata() {
  return buildMetadata({
    title: "福岡の演劇公演スケジュール｜カレンダーで上演日を確認",
    description:
      "福岡で開催される演劇・舞台公演のスケジュールをカレンダーで一覧。日付から上演中・今後の公演を探して、作品の詳細やチケット情報をチェックできます。",
    path: "/calendar",
  });
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// days[]（UTC深夜として表現したJST暦日の疑似Date）を「7月13日(月)」形式にする
const formatFullDate = (pseudoDate: Date) =>
  `${pseudoDate.getUTCMonth() + 1}月${pseudoDate.getUTCDate()}日(${WEEKDAY_LABELS[pseudoDate.getUTCDay()]})`;

const formatDate = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(date);
};

const buildEventUrl = (siteUrl: string, category: string, slug: string) =>
  `${siteUrl}/events/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`;

// JSON-LD の </script> 突破を防ぐため < をエスケープ
const toJsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

type CalendarSearchParams = { week?: string; cat?: string };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams?: CalendarSearchParams | Promise<CalendarSearchParams>;
}) {
  const resolvedSearchParams = await Promise.resolve(searchParams);
  const weekStartIso = normalizeWeekParam(resolvedSearchParams?.week);
  const rawCat = (resolvedSearchParams?.cat ?? "").trim();

  const [timetable, upcomingEvents] = await Promise.all([
    getWeekTimetable(weekStartIso, rawCat || undefined),
    getUpcomingEvents({ limit: 50 }),
  ]);

  // 不正なcatは無視する（timetable.categoriesに実在するIDだけ有効として扱う）
  const activeCat = timetable.categories.some((category) => category.id === rawCat) ? rawCat : "";
  const days = timetable.weeks.days;
  const prevWeekIso = shiftWeekIso(weekStartIso, -1);
  const nextWeekIso = shiftWeekIso(weekStartIso, 1);
  const thisWeekIso = normalizeWeekParam();
  const isThisWeek = weekStartIso === thisWeekIso;
  const weekRangeLabel = `${formatFullDate(days[0])} 〜 ${formatFullDate(days[6])}`;

  const siteUrl = getSiteUrl();
  const pageUrl = `${siteUrl}/calendar`;

  const eventItems = upcomingEvents.map((event, index) => {
    const theaterEvent: Record<string, unknown> = {
      "@type": "TheaterEvent",
      name: event.title,
      startDate: event.start_date,
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: {
        "@type": "Place",
        name: event.venue?.trim() || "福岡県内の劇場",
        address: {
          "@type": "PostalAddress",
          addressRegion: "福岡県",
          addressCountry: "JP",
        },
      },
      url: buildEventUrl(siteUrl, event.category, event.slug),
    };
    if (event.end_date) theaterEvent.endDate = event.end_date;
    if (event.company?.trim()) {
      theaterEvent.organizer = {
        "@type": "Organization",
        name: event.company.trim(),
      };
    }
    return { "@type": "ListItem", position: index + 1, item: theaterEvent };
  });

  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "福岡の演劇公演スケジュール",
    description:
      "福岡で開催される演劇・舞台公演のスケジュール。上演日をカレンダーで確認できます。",
    url: pageUrl,
    isPartOf: { "@type": "WebSite", name: "福岡アクトポータル", url: siteUrl },
    ...(eventItems.length > 0
      ? {
          mainEntity: {
            "@type": "ItemList",
            name: "近日開催の福岡の演劇公演",
            itemListElement: eventItems,
          },
        }
      : {}),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "ホーム", item: siteUrl },
      { "@type": "ListItem", position: 2, name: "公演スケジュール", item: pageUrl },
    ],
  };

  const visibleUpcomingEvents = upcomingEvents.slice(0, 12);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: toJsonLd(collectionLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: toJsonLd(breadcrumbLd) }}
      />

      <div className="card-retro p-6 md:p-8">
        <span className="badge-retro bg-pop-green shadow-hard-sm text-xs">
          CALENDAR
        </span>
        <h1 className="mt-3 font-display text-3xl tracking-tight md:text-4xl">
          福岡の演劇公演スケジュール
        </h1>
        <p className="mt-2 text-sm text-zinc-700">
          福岡で開催される演劇・舞台公演の日程を、会場×週の番組表で確認できます。気になる公演は、そのまま詳細やチケット情報もチェックできますよ。
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={buildCalendarHref(prevWeekIso, activeCat)} className="btn-retro btn-surface">
            ← 前週
          </Link>
          <Link
            href={buildCalendarHref(thisWeekIso, activeCat)}
            className={`btn-retro ${isThisWeek ? "btn-ink" : "btn-surface"}`}
          >
            今週
          </Link>
          <Link href={buildCalendarHref(nextWeekIso, activeCat)} className="btn-retro btn-surface">
            次週 →
          </Link>
        </div>
        <div className="text-sm font-bold text-ink">{weekRangeLabel}</div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link
          href={buildCalendarHref(weekStartIso, "")}
          className={`badge-retro shadow-hard-sm ${activeCat ? "bg-surface" : "bg-ink text-white"}`}
        >
          すべて
        </Link>
        {timetable.categories.map((category) => {
          const isActive = activeCat === category.id;
          return (
            <Link
              key={category.id}
              href={buildCalendarHref(weekStartIso, category.id)}
              className={`badge-retro shadow-hard-sm ${isActive ? "" : "bg-surface"}`}
              style={
                isActive
                  ? {
                      backgroundColor: category.color ?? "#90A4AE",
                      color: getReadableTextColor(category.color),
                    }
                  : undefined
              }
            >
              <span aria-hidden>{category.icon ?? "🎭"}</span>
              <span>{category.name}</span>
            </Link>
          );
        })}
      </div>

      <div className="mt-4">
        <WeekTimetable
          weekStartIso={weekStartIso}
          activeCategory={activeCat}
          days={days}
          areas={timetable.areas}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
        {timetable.categories.map((category) => (
          <span key={category.id} className="inline-flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-full border border-ink"
              style={{ backgroundColor: category.color ?? "#90A4AE" }}
            />
            {category.name}
          </span>
        ))}
      </div>

      {visibleUpcomingEvents.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-2xl tracking-tight">
            近日開催の福岡の演劇公演スケジュール
          </h2>
          <p className="mt-2 text-sm text-zinc-700">
            これから上演される福岡の演劇・舞台公演を、開催日順に紹介します。
          </p>
          <ul className="mt-4 grid gap-3">
            {visibleUpcomingEvents.map((event) => (
              <li key={event.id} className="card-retro p-4">
                <Link
                  href={`/events/${encodeURIComponent(
                    event.category
                  )}/${encodeURIComponent(event.slug)}`}
                  className="font-bold hover:underline"
                >
                  {event.title}
                </Link>
                <div className="mt-1 text-xs text-zinc-600">
                  {formatDate(event.start_date)}
                  {event.end_date ? ` 〜 ${formatDate(event.end_date)}` : ""}
                  {event.venue ? `／${event.venue}` : ""}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <Link href="/events" className="btn-retro btn-surface">
              すべての公演を見る
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

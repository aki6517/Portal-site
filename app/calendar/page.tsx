import Link from "next/link";
import CalendarClient from "./CalendarClient";
import { buildMetadata, getSiteUrl } from "@/lib/seo";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  return buildMetadata({
    title: "福岡の演劇公演スケジュール｜カレンダーで上演日を確認",
    description:
      "福岡で開催される演劇・舞台公演のスケジュールをカレンダーで一覧。日付から上演中・今後の公演を探して、作品の詳細やチケット情報をチェックできます。",
    path: "/calendar",
  });
}

type CalendarEventRecord = {
  id: string;
  title: string;
  category: string;
  slug: string;
  start_date: string;
  end_date?: string | null;
  venue?: string | null;
  company?: string | null;
  publish_at?: string | null;
};

const isReleased = (publishAt?: string | null) => {
  if (!publishAt) return true;
  const date = new Date(publishAt);
  if (Number.isNaN(date.getTime())) return true;
  return date.getTime() <= Date.now();
};

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

// 公開済み・今後開催（前日以降に終わる）の公演を開催日順に取得。失敗時は空配列でフォールバック。
const getUpcomingEvents = async (): Promise<CalendarEventRecord[]> => {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("events")
      .select(
        "id, title, category, slug, start_date, end_date, venue, company, publish_at"
      )
      .eq("status", "published")
      .order("start_date", { ascending: true });
    const rows = ((data ?? []) as CalendarEventRecord[]).filter((event) =>
      isReleased(event.publish_at)
    );
    const threshold = Date.now() - 24 * 60 * 60 * 1000;
    const upcoming = rows.filter((event) => {
      const end = new Date(event.end_date ?? event.start_date);
      return !Number.isNaN(end.getTime()) && end.getTime() >= threshold;
    });
    return upcoming.slice(0, 50);
  } catch {
    return [];
  }
};

const buildEventUrl = (siteUrl: string, category: string, slug: string) =>
  `${siteUrl}/events/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`;

// JSON-LD の </script> 突破を防ぐため < をエスケープ
const toJsonLd = (data: unknown) =>
  JSON.stringify(data).replace(/</g, "\\u003c");

export default async function CalendarPage() {
  const events = await getUpcomingEvents();
  const siteUrl = getSiteUrl();
  const pageUrl = `${siteUrl}/calendar`;

  const eventItems = events.map((event, index) => {
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

  const visibleEvents = events.slice(0, 12);

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
        <span className="badge-retro bg-pop-green shadow-hard-sm text-[11px]">
          CALENDAR
        </span>
        <h1 className="mt-3 font-display text-3xl tracking-tight md:text-4xl">
          福岡の演劇公演スケジュール
        </h1>
        <p className="mt-2 text-sm text-zinc-700">
          福岡で開催される演劇・舞台公演の日程を、カレンダーで確認できます。気になる公演は、そのまま詳細やチケット情報もチェックできますよ。
        </p>
      </div>

      <div className="mt-6">
        <CalendarClient />
      </div>

      {visibleEvents.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-2xl tracking-tight">
            近日開催の福岡の演劇公演スケジュール
          </h2>
          <p className="mt-2 text-sm text-zinc-700">
            これから上演される福岡の演劇・舞台公演を、開催日順に紹介します。
          </p>
          <ul className="mt-4 grid gap-3">
            {visibleEvents.map((event) => (
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

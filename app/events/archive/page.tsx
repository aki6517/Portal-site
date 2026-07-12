import Link from "next/link";
import ImageWithFallback from "@/app/_components/ImageWithFallback";
import { buildEventImageCandidates } from "@/lib/events/image";
import { getArchivedEvents } from "@/lib/data/events";
import { buildMetadata } from "@/lib/seo";

// 過去公演アーカイブ（Phase 4）。ルーティングはNext.jsの静的セグメント優先ルールにより
// app/events/[category] より本ルートが優先される（categoriesテーブルにid="archive"が
// 無いことは確認済み）。

const PAGE_SIZE = 24;

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

const getEventImageCandidates = (event: {
  image_url?: string | null;
  flyer_url?: string | null;
}) => buildEventImageCandidates(event.image_url, event.flyer_url);

const parsePage = (value?: string) => {
  const parsed = Number(value ?? "1");
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
};

export async function generateMetadata() {
  return buildMetadata({
    title: "過去公演アーカイブ",
    description: "福岡で過去に上演された演劇・舞台公演のアーカイブ一覧です。",
    path: "/events/archive",
  });
}

export default async function EventsArchivePage({
  searchParams,
}: {
  searchParams?: { page?: string } | Promise<{ page?: string }>;
}) {
  const resolvedSearchParams = await Promise.resolve(searchParams);
  const requestedPage = parsePage(resolvedSearchParams?.page);
  const events = await getArchivedEvents();

  const totalPages = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * PAGE_SIZE;
  const pageEvents = events.slice(start, start + PAGE_SIZE);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="heading-ja text-3xl">過去公演アーカイブ</h1>
          <p className="mt-2 text-sm text-zinc-700">
            終演した公演を終演日の新しい順に一覧できます。
          </p>
        </div>
        <Link href="/events" className="badge-retro bg-surface shadow-hard-sm">
          ← 公演一覧に戻る
        </Link>
      </div>

      <div className="mt-8 grid gap-4">
        {pageEvents.length === 0 && (
          <div className="rounded-2xl border-2 border-ink bg-surface p-6 text-sm text-zinc-700 shadow-hard-sm">
            過去公演はまだありません。
          </div>
        )}
        {pageEvents.map((event) => {
          const imageCandidates = getEventImageCandidates(event);
          return (
            <div key={event.id} className="card-retro p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="mb-1">
                    <span className="badge-retro bg-surface-muted">終了</span>
                  </div>
                  <Link
                    href={`/events/${encodeURIComponent(
                      event.category
                    )}/${encodeURIComponent(event.slug)}`}
                    className="text-lg font-black hover:underline"
                  >
                    {event.title}
                  </Link>
                  {event.company && (
                    <div className="mt-1 text-xs text-zinc-600">{event.company}</div>
                  )}
                  <div className="mt-1 text-xs text-zinc-600">
                    {formatDate(event.start_date)}
                    {event.end_date ? ` 〜 ${formatDate(event.end_date)}` : ""}
                  </div>
                  {event.venue && (
                    <div className="text-xs text-zinc-600">{event.venue}</div>
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

      {totalPages > 1 && (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {page > 1 ? (
            <Link
              href={`/events/archive?page=${page - 1}`}
              className="btn-retro btn-surface"
            >
              前へ
            </Link>
          ) : (
            <span className="btn-retro btn-surface pointer-events-none opacity-40">
              前へ
            </span>
          )}
          <span className="text-sm font-bold text-zinc-700">
            {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={`/events/archive?page=${page + 1}`}
              className="btn-retro btn-surface"
            >
              次へ
            </Link>
          ) : (
            <span className="btn-retro btn-surface pointer-events-none opacity-40">
              次へ
            </span>
          )}
        </div>
      )}
    </div>
  );
}

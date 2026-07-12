import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import ImageWithFallback from "@/app/_components/ImageWithFallback";
import { buildEventImageCandidates } from "@/lib/events/image";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  getEventById,
  getEventBySlug,
  getRelatedEvents,
  isReleased,
  type EventDetail,
} from "@/lib/data/events";
import { isEnded, shouldNoindex } from "@/lib/events/lifecycle";
import ViewCounter from "./ViewCounter";
import { buildMetadata, getSiteUrl } from "@/lib/seo";

export const revalidate = 600;

type EventRecord = EventDetail;

const CATEGORY_COPY: Record<string, { label: string; icon: string }> = {
  comedy: { label: "コメディ", icon: "😂" },
  conversation: { label: "会話劇", icon: "💬" },
  musical: { label: "ミュージカル", icon: "🎵" },
  classic: { label: "古典・時代劇", icon: "🏯" },
  action: { label: "アクション", icon: "⚔️" },
  serious: { label: "シリアス", icon: "🎬" },
  drama: { label: "ドラマ", icon: "🎭" },
  dance: { label: "ダンス", icon: "💃" },
  student: { label: "学生演劇", icon: "🎓" },
  conte: { label: "コント", icon: "🎭" },
  experimental: { label: "実験的", icon: "🔬" },
  other: { label: "その他", icon: "📌" },
};

const formatDateParts = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
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
  const parts = formatter.formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const dateText = `${get("year")}年${get("month")}月${get("day")}日（${get(
    "weekday"
  )}）`;
  const timeText = `${get("hour")}:${get("minute")}`;
  return { dateText, timeText };
};

const formatDate = (value?: string | null) => {
  const parts = formatDateParts(value);
  if (!parts) return value ?? "";
  return `${parts.dateText} ${parts.timeText}`.trim();
};

const formatScheduleStart = (value?: string | null) => {
  const parts = formatDateParts(value);
  if (!parts) return value ?? "";
  return `${parts.dateText} ${parts.timeText}`;
};

const formatScheduleDisplay = (item: {
  start_date?: string;
  end_date?: string | null;
  label?: string;
}) => {
  const startParts = formatDateParts(item.start_date ?? "");
  const label = item.label?.trim() ?? "";
  if (!startParts) {
    return {
      main: item.start_date ?? "",
      note: label ? `◆${label}` : "",
    };
  }
  const startText = `${startParts.dateText} ${startParts.timeText}`.trim();
  const endText = item.end_date ? formatDate(item.end_date) : "";
  const main = endText ? `${startText} 〜 ${endText}` : startText;
  const note = label ? `◆${label}` : "";
  return { main, note };
};

const normalizeScheduleRows = (
  raw: EventRecord["schedule_times"],
  fallbackStartDate: string
) => {
  const fromArray = Array.isArray(raw)
    ? raw
        .map((item) => {
          const candidate = item as unknown;
          if (!candidate) return null;
          if (typeof candidate === "string") {
            const start = candidate.trim();
            return start
              ? { start_date: start, end_date: null, label: "" }
              : null;
          }
          if (typeof candidate !== "object") return null;
          const record = candidate as {
            start_date?: string;
            end_date?: string | null;
            label?: string;
          };
          return {
            start_date: (record.start_date ?? "").trim(),
            end_date: record.end_date ? record.end_date.trim() : null,
            label: (record.label ?? "").trim(),
          };
        })
        .filter(
          (
            item
          ): item is { start_date: string; end_date: string | null; label: string } =>
            Boolean(item?.start_date)
        )
    : [];

  const merged =
    fromArray.length > 0
      ? fromArray
      : [{ start_date: fallbackStartDate, end_date: null, label: "" }];

  const unique = Array.from(
    new Map(
      merged.map((item) => [`${item.start_date}::${item.label}`, item] as const)
    ).values()
  );

  return unique.sort((a, b) => a.start_date.localeCompare(b.start_date));
};

const decodeRouteParam = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const isReservationOpen = (reservationStartAt?: string | null) => {
  if (!reservationStartAt) return true;
  const date = new Date(reservationStartAt);
  if (Number.isNaN(date.getTime())) return true;
  return date.getTime() <= Date.now();
};

const getEventImageCandidates = (event: {
  image_url?: string | null;
  flyer_url?: string | null;
}) => buildEventImageCandidates(event.image_url, event.flyer_url);

// superseded_by（再演時に手動指定される後継公演）が公開中ならその詳細を返す。
// 未設定・後継が非公開/削除済みの場合はnull（= 元のページをそのまま案内する）。
const resolveSupersededTarget = async (event: EventRecord) => {
  const supersededId = event.superseded_by;
  if (!supersededId) return null;
  return getEventById(supersededId);
};

// JSON-LDのoffers。ticket_types（券種ごとの価格）があれば各券種をOfferに、
// 無ければprice_general/price_studentから生成する。価格情報が一切無い場合と
// 終演後（ended）はoffers自体を省略する。
const buildOffers = (event: EventRecord, ended: boolean) => {
  if (ended) return undefined;

  const buildOffer = (name: string, price: number) => ({
    "@type": "Offer",
    name,
    price,
    priceCurrency: "JPY",
    url: event.ticket_url || undefined,
    availability: "https://schema.org/InStock",
  });

  const pricedTicketTypes = (Array.isArray(event.ticket_types) ? event.ticket_types : []).filter(
    (item): item is { label?: string | null; price: number; note?: string | null } =>
      Boolean(item) && typeof item?.price === "number"
  );
  if (pricedTicketTypes.length > 0) {
    return pricedTicketTypes.map((item) =>
      buildOffer(item.label?.trim() || "チケット", item.price)
    );
  }

  const generated: ReturnType<typeof buildOffer>[] = [];
  if (typeof event.price_general === "number") {
    generated.push(buildOffer("一般", event.price_general));
  }
  if (typeof event.price_student === "number") {
    generated.push(buildOffer("学生", event.price_student));
  }
  return generated.length > 0 ? generated : undefined;
};

// castの1要素から名前を取り出す。実データはEventFormが保存する
// {name, role, image_url} 形式だけでなく、文字列そのもの（例: "坂東玉三郎"）の
// 配列で入っているケースが本番DBに実在するため、両方に対応する。
const getCastMemberName = (member: unknown): string => {
  if (typeof member === "string") return member.trim();
  if (member && typeof member === "object" && "name" in member) {
    return String((member as { name?: unknown }).name ?? "").trim();
  }
  return "";
};

// JSON-LDのperformer。cast（キャスト）にnameがあればPerson[]、
// 無ければcompany（劇団名）をPerformingGroupとして1件返す。
const buildPerformer = (event: EventRecord) => {
  const castNames = (Array.isArray(event.cast) ? event.cast : [])
    .map(getCastMemberName)
    .filter((name) => name.length > 0);
  if (castNames.length > 0) {
    return castNames.map((name) => ({ "@type": "Person", name }));
  }
  const companyName = (event.company ?? "").trim();
  if (companyName) {
    return { "@type": "PerformingGroup", name: companyName };
  }
  return undefined;
};

const tryRedirect = async (category: string, slug: string) => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const service = createSupabaseServiceClient();
  const { data: redirect } = await service
    .from("event_redirects")
    .select("to_event_id")
    .eq("from_category", category)
    .eq("from_slug", slug)
    .maybeSingle();

  if (!redirect?.to_event_id) return;

  const { data: target } = await service
    .from("events")
    .select("category, slug, status, publish_at")
    .eq("id", redirect.to_event_id)
    .maybeSingle();

  if (!target || target.status !== "published" || !isReleased(target.publish_at)) {
    return;
  }
  permanentRedirect(
    `/events/${encodeURIComponent(target.category)}/${encodeURIComponent(
      target.slug
    )}`
  );
};

export async function generateMetadata({
  params,
}: {
  params: { category: string; slug: string } | Promise<{ category: string; slug: string }>;
}) {
  const resolvedParams = await Promise.resolve(params);
  const category = decodeRouteParam(resolvedParams.category);
  const slug = decodeRouteParam(resolvedParams.slug);
  const event = await getEventBySlug(category, slug);
  const path = `/events/${resolvedParams.category}/${resolvedParams.slug}`;
  if (!event) {
    return buildMetadata({ title: "公演詳細", path });
  }
  const supersededTarget = await resolveSupersededTarget(event);
  const canonicalPath = supersededTarget
    ? `/events/${encodeURIComponent(supersededTarget.category)}/${encodeURIComponent(
        supersededTarget.slug
      )}`
    : path;
  const image = getEventImageCandidates(event)[0] ?? undefined;
  return buildMetadata({
    title: event.title,
    description: event.description ?? undefined,
    path: canonicalPath,
    image,
    noindex: shouldNoindex(event),
  });
}

export default async function EventDetailPage({
  params,
}: {
  params: { category: string; slug: string } | Promise<{ category: string; slug: string }>;
}) {
  const resolvedParams = await Promise.resolve(params);
  const category = decodeRouteParam(resolvedParams.category);
  const slug = decodeRouteParam(resolvedParams.slug);
  const event = await getEventBySlug(category, slug);

  if (!event) {
    await tryRedirect(category, slug);
    notFound();
  }
  if (event.category !== category) {
    permanentRedirect(
      `/events/${encodeURIComponent(event.category)}/${encodeURIComponent(
        event.slug
      )}`
    );
  }

  const categoryCopy = CATEGORY_COPY[event.category] ?? {
    label: event.category,
    icon: "🎟️",
  };
  const siteUrl = getSiteUrl();
  const imageCandidates = getEventImageCandidates(event);
  const primaryImage = imageCandidates[0] ?? null;
  const scheduleTimes = normalizeScheduleRows(event.schedule_times, event.start_date);
  const firstSchedule = scheduleTimes[0];
  const lastSchedule = scheduleTimes[scheduleTimes.length - 1];
  const start = formatDate(firstSchedule?.start_date ?? event.start_date);
  const end = formatDate(lastSchedule?.end_date ?? event.end_date);
  const dateLabel = end ? `${start} 〜 ${end}` : start;
  const hasMultipleSchedules = scheduleTimes.length > 1;
  const ticketTypes = Array.isArray(event.ticket_types)
    ? event.ticket_types
    : [];
  const reservationLinks = (() => {
    const rows = Array.isArray(event.reservation_links)
      ? event.reservation_links
          .map((item) => ({
            label: (item?.label ?? "").trim(),
            url: (item?.url ?? "").trim(),
          }))
          .filter((item) => item.label || item.url)
      : [];
    if (rows.length > 0) return rows;
    if (!event.reservation_label && !event.ticket_url) return [];
    return [
      {
        label: (event.reservation_label ?? "").trim(),
        url: (event.ticket_url ?? "").trim(),
      },
    ];
  })();
  const playwright = (event.playwright ?? "").trim();
  const director = (event.director ?? "").trim();
  const isSameStaff = Boolean(playwright && director && playwright === director);
  const reservationOpen = isReservationOpen(event.reservation_start_at);
  const ended = isEnded(event);
  // source_urlsが1件以上あれば、portal-scout（AI自動収集）由来の公演とみなし、
  // 主催者向けの「ご自身で更新できます」告知を出す
  const isAiSourced = Array.isArray(event.source_urls) && event.source_urls.length > 0;
  const [related, supersededTarget] = await Promise.all([
    getRelatedEvents(event.category, event.id),
    resolveSupersededTarget(event),
  ]);

  const startIso = event.start_date;
  const endIso = event.end_date ?? event.start_date;
  const breadcrumbs = [
    {
      "@type": "ListItem",
      position: 1,
      name: "トップ",
      item: `${siteUrl}/`,
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "公演一覧",
      item: `${siteUrl}/events/`,
    },
    {
      "@type": "ListItem",
      position: 3,
      name: categoryCopy.label,
      item: `${siteUrl}/events/${encodeURIComponent(event.category)}/`,
    },
    {
      "@type": "ListItem",
      position: 4,
      name: event.title,
      item: `${siteUrl}/events/${encodeURIComponent(event.category)}/${encodeURIComponent(
        event.slug
      )}`,
    },
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TheaterEvent",
    name: event.title,
    description: event.description ?? undefined,
    startDate: startIso,
    endDate: endIso,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: event.venue ?? "未設定",
      address: event.venue_address ?? undefined,
    },
    image: primaryImage ? [primaryImage] : undefined,
    organizer: {
      "@type": "Organization",
      name: event.company,
    },
    performer: buildPerformer(event),
    offers: buildOffers(event, ended),
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbs,
  };

  return (
    <div className="mx-auto max-w-6xl overflow-x-hidden px-4 py-10">
      <ViewCounter category={event.category} slug={event.slug} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <nav className="text-xs">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/" className="badge-retro bg-surface">
              トップ
            </Link>
          </li>
          <li>
            <span className="px-1 text-ink-muted">→</span>
          </li>
          <li>
            <Link href="/events" className="badge-retro bg-surface">
              公演一覧
            </Link>
          </li>
          <li>
            <span className="px-1 text-ink-muted">→</span>
          </li>
          <li>
            <Link
              href={`/events/${encodeURIComponent(event.category)}`}
              className="badge-retro bg-surface"
            >
              <span aria-hidden>{categoryCopy.icon}</span>
              {categoryCopy.label}
            </Link>
          </li>
          <li>
            <span className="px-1 text-ink-muted">→</span>
          </li>
          <li className="max-w-full rounded-full border-2 border-ink bg-primary px-3 py-1 text-xs font-black leading-tight text-white break-words">
            {event.title}
          </li>
        </ol>
      </nav>

      {supersededTarget && (
        <div className="card-retro mt-4 flex flex-wrap items-center justify-between gap-3 bg-primary p-4 text-white">
          <p className="text-sm font-black">この公演の最新情報はこちら</p>
          <Link
            href={`/events/${encodeURIComponent(
              supersededTarget.category
            )}/${encodeURIComponent(supersededTarget.slug)}`}
            className="btn-retro btn-ink"
          >
            最新の公演情報を見る
          </Link>
        </div>
      )}

      {ended && (
        <div className="card-retro mt-4 flex flex-wrap items-center justify-between gap-3 bg-surface-muted p-4">
          <p className="flex flex-wrap items-center gap-2 text-sm font-black text-ink">
            <span className="badge-retro bg-ink text-white">終了しました</span>
            この公演は終了しました。
          </p>
          <Link href="/events/archive" className="btn-retro btn-surface">
            過去公演アーカイブを見る
          </Link>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="card-retro p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge-retro bg-secondary">
              <span aria-hidden>{categoryCopy.icon}</span>
              {categoryCopy.label}
            </span>
            {Array.isArray(event.categories) &&
              event.categories
                .filter((item) => item && item !== event.category)
                .map((item) => (
                  <span key={item} className="badge-retro bg-surface">
                    {CATEGORY_COPY[item]?.label ?? item}
                  </span>
                ))}
            <span className="badge-retro bg-surface-muted max-w-full whitespace-normal break-all text-xs">
              <span className="font-mono">/{event.category}/{event.slug}</span>
            </span>
          </div>

          <h1 className="heading-ja mt-4 text-2xl leading-tight text-ink sm:text-3xl md:text-4xl">
            {event.title}
          </h1>
          <p className="mt-2 text-base font-semibold text-zinc-800">
            {event.company}
          </p>

          {isAiSourced && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border-2 border-ink bg-surface-muted px-4 py-3 text-sm text-ink">
              <p className="min-w-[200px] flex-1">
                この公演情報は公式発表をもとに編集部が掲載しています。主催者の方はご自身で情報の更新・掲載ができます。
              </p>
              <Link href="/register" className="btn-retro btn-surface shrink-0 text-sm">
                公演を登録する
              </Link>
            </div>
          )}

          <div className="mt-5 grid gap-3 text-base leading-relaxed">
            <div>
              <span className="font-semibold">開催日時:</span> {dateLabel}
            </div>
            {scheduleTimes.length > 0 && (
              <div>
                <span className="font-semibold">公演日程:</span>
                <div className="mt-2 grid gap-1 text-sm text-zinc-700">
                  {scheduleTimes.map((item, index) => {
                    const { main, note } = formatScheduleDisplay(item);
                    const exactStart = formatScheduleStart(item.start_date ?? "");
                    return (
                      <div key={`schedule-${index}`} className="flex flex-wrap gap-2">
                        <span className="badge-retro bg-surface-muted">
                          {hasMultipleSchedules ? exactStart : main}
                        </span>
                        {note && (
                          <span className="text-xs text-zinc-600">{note}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {event.venue && (
              <div>
                <span className="font-semibold">会場:</span> {event.venue}
              </div>
            )}
            {event.venue_address && (
              <div className="break-words">
                <span className="font-semibold">住所:</span>{" "}
                {event.venue_address}
              </div>
            )}
            {ticketTypes.length > 0 && (
              <div>
                <span className="font-semibold">チケット種別:</span>
                <div className="mt-2 grid gap-2 text-sm text-zinc-700">
                  {ticketTypes.map((item, index) => (
                    <div key={`ticket-${index}`} className="flex flex-wrap gap-2">
                      <span className="badge-retro bg-secondary">
                        {item.label ?? "チケット"}
                      </span>
                      {item.price !== null && item.price !== undefined && (
                        <span>{item.price}円</span>
                      )}
                      {item.note && (
                        <span className="text-sm text-zinc-600">
                          {item.note}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!ticketTypes.length && (event.price_general || event.price_student) && (
              <div>
                <span className="font-semibold">料金:</span>{" "}
                {event.price_general ? `一般 ${event.price_general}円` : ""}
                {event.price_general && event.price_student ? " / " : ""}
                {event.price_student ? `学生 ${event.price_student}円` : ""}
              </div>
            )}
            {!ended && (reservationLinks.length > 0 || event.reservation_start_at) && (
              <div>
                {event.reservation_start_at && (
                  <div>
                    <span className="font-semibold">予約開始:</span>{" "}
                    {formatDate(event.reservation_start_at)}
                  </div>
                )}
                {reservationLinks.length > 0 && (
                  <div className="mt-2 grid gap-1 text-sm text-zinc-700">
                    <div>
                      <span className="font-semibold">予約受付:</span>
                    </div>
                    {reservationLinks.map((item, index) => (
                      <div key={`reservation-link-${index}`} className="flex flex-wrap gap-2">
                        {item.url && reservationOpen ? (
                          <a
                            className="link-retro"
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {item.label ||
                              `予約ページ${reservationLinks.length > 1 ? ` ${index + 1}` : ""}`}
                          </a>
                        ) : (
                          <span>
                            {item.label ||
                              `予約ページ${reservationLinks.length > 1 ? ` ${index + 1}` : ""}`}
                          </span>
                        )}
                        {!reservationOpen && item.url ? (
                          <span className="badge-retro bg-surface-muted text-xs">
                            予約開始前
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {event.tags && event.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {event.tags.map((tag) => (
                <span
                  key={tag}
                  className="badge-retro bg-surface-muted max-w-full whitespace-normal break-words text-xs"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="card-retro overflow-hidden">
          <ImageWithFallback
            srcCandidates={imageCandidates}
            alt={event.title}
            width={800}
            height={1000}
            sizes="(min-width: 1024px) 40vw, 100vw"
            className="h-full w-full bg-surface object-cover"
            fallback={
              <div className="flex h-80 items-center justify-center bg-surface text-sm text-zinc-600">
                画像は未登録です
              </div>
            }
          />
        </div>
      </div>

      {event.description && (
        <div className="card-retro mt-10 p-6">
          <h2 className="heading-ja text-xl">あらすじ</h2>
          <p className="mt-3 whitespace-pre-wrap break-words text-base leading-relaxed text-zinc-800">
            {event.description}
          </p>
        </div>
      )}

      <div className="card-retro mt-8 p-6">
        <h2 className="heading-ja text-xl">脚本・演出</h2>
        <div className="mt-3 grid gap-2 text-base leading-relaxed">
          {!playwright && !director && (
            <div className="text-zinc-600">脚本・演出情報は準備中です。</div>
          )}
          {isSameStaff ? (
            <div>
              <span className="font-semibold">脚本・演出:</span> {playwright}
            </div>
          ) : (
            <>
              {playwright && (
                <div>
                  <span className="font-semibold">脚本:</span> {playwright}
                </div>
              )}
              {director && (
                <div>
                  <span className="font-semibold">演出:</span> {director}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {event.cast && event.cast.length > 0 && (
        <div className="card-retro mt-8 p-6">
          <h2 className="heading-ja text-xl">キャスト</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {event.cast.map((member, index) => {
              const name = getCastMemberName(member);
              const role =
                member && typeof member === "object" && "role" in member
                  ? String((member as { role?: unknown }).role ?? "").trim()
                  : "";
              return (
                <div
                  key={`${name || "cast"}-${index}`}
                  className="rounded-xl border-2 border-ink bg-surface p-4 shadow-hard-sm"
                >
                  <div className="font-bold">{name || "名称未設定"}</div>
                  {role && (
                    <div className="mt-1 text-sm text-zinc-700">{role}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {related.length > 0 && (
        <div className="mt-10">
          <h2 className="heading-ja text-xl">関連の公演</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {related.map((item) => {
              const thumbCandidates = getEventImageCandidates(item);
              return (
                <Link
                  key={item.id}
                  href={`/events/${encodeURIComponent(
                    item.category
                  )}/${encodeURIComponent(item.slug)}`}
                  className="card-retro block overflow-hidden transition-transform hover:-translate-y-0.5"
                >
                  <div className="aspect-[4/3] bg-surface-muted">
                    <ImageWithFallback
                      srcCandidates={thumbCandidates}
                      alt={item.title}
                      width={800}
                      height={600}
                      sizes="(min-width: 1024px) 20vw, (min-width: 768px) 33vw, 100vw"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="p-4">
                    <div className="text-sm font-black">{item.title}</div>
                    <div className="mt-1 text-xs text-zinc-700">
                      {formatDate(item.start_date)}
                      {item.venue ? ` / ${item.venue}` : ""}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="card-retro mt-10 bg-secondary p-6">
        <h2 className="heading-ja text-xl">
          公演を掲載したい劇団の方へ
        </h2>
        <p className="mt-2 text-base text-zinc-800">
          ログイン後に劇団情報を入力すると、公演の作成・編集ができます。
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-base">
          <Link
            href="/register"
            className="btn-retro btn-ink"
          >
            公演を登録する
          </Link>
          <Link
            href="/theater"
            className="btn-retro btn-surface"
          >
            管理画面へ
          </Link>
        </div>
      </div>
    </div>
  );
}

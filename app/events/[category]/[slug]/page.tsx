import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import ViewCounter from "./ViewCounter";
import { buildMetadata, getSiteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

type EventRecord = {
  id: string;
  title: string;
  company: string;
  description: string | null;
  category: string;
  categories?: string[] | null;
  slug: string;
  start_date: string;
  end_date: string | null;
  schedule_times?: { start_date?: string; end_date?: string | null; label?: string }[] | null;
  venue: string | null;
  venue_address: string | null;
  price_general: number | null;
  price_student: number | null;
  ticket_types?: { label?: string | null; price?: number | null; note?: string | null }[] | null;
  tags: string[] | null;
  image_url: string | null;
  flyer_url: string | null;
  ticket_url: string | null;
  cast: { name?: string; role?: string; image_url?: string }[] | null;
};

type RelatedEvent = {
  id: string;
  category: string;
  slug: string;
  title: string;
  start_date: string;
  venue: string | null;
  flyer_url: string | null;
  image_url: string | null;
};

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
  let mainLabel = "";
  let noteLabel = "";
  if (label) {
    const labelMatch = label.match(/(朝公演|昼公演|夜公演|マチネ|ソワレ|午前|午後)/);
    if (labelMatch) {
      mainLabel = labelMatch[0];
      noteLabel = label.replace(labelMatch[0], "").trim();
      noteLabel = noteLabel.replace(/^[：:・\s]+/, "");
    } else {
      noteLabel = label;
    }
  } else {
    const hour = Number(startParts.timeText.split(":")[0]);
    if (!Number.isNaN(hour)) {
      if (hour < 11) mainLabel = "朝公演";
      else if (hour < 17) mainLabel = "昼公演";
      else mainLabel = "夜公演";
    }
  }
  const timeText = mainLabel
    ? `${mainLabel}: ${startParts.timeText}`
    : startParts.timeText;
  const startText = `${startParts.dateText} ${timeText}`.trim();
  const endText = item.end_date ? formatDate(item.end_date) : "";
  const main = endText ? `${startText} 〜 ${endText}` : startText;
  const note = noteLabel ? `◆${noteLabel}` : "";
  return { main, note };
};

const getEvent = async (category: string, slug: string) => {
  const supabase = await createSupabaseServerClient();
  const selectFields =
    "id, title, company, description, category, categories, slug, start_date, end_date, schedule_times, venue, venue_address, price_general, price_student, ticket_types, tags, image_url, flyer_url, ticket_url, cast";

  const { data, error } = await supabase
    .from("events")
    .select(selectFields)
    .eq("slug", slug)
    .or(`category.eq.${category},categories.cs.{${category}}`)
    .eq("status", "published")
    .maybeSingle<EventRecord>();

  if (!error && data) return data;
  if (!error && !data) {
    console.warn("[event-detail] not found (anon)", {
      category,
      slug,
    });
  }
  if (error) {
    console.warn("[event-detail] query error (anon)", error.message);
  }

  const message = error?.message ?? "";
  const missingColumns = message.includes("column") || message.includes("does not exist");
  const multipleRows = message.toLowerCase().includes("multiple");

  if (multipleRows) {
    const { data: candidates } = await supabase
      .from("events")
      .select(selectFields)
      .eq("slug", slug)
      .eq("status", "published")
      .returns<EventRecord[]>();
    const matched =
      candidates?.find(
        (item) =>
          item.category === category ||
          (Array.isArray(item.categories) && item.categories.includes(category))
      ) ?? candidates?.[0];
    if (matched) return matched;
  }

  if (missingColumns) {
    const fallback = await supabase
      .from("events")
      .select(
        "id, title, company, description, category, slug, start_date, end_date, venue, venue_address, price_general, price_student, tags, image_url, flyer_url, ticket_url, cast"
      )
      .eq("slug", slug)
      .eq("status", "published")
      .returns<EventRecord[]>();
    const matched =
      fallback.data?.find((item) => item.category === category) ??
      fallback.data?.[0];
    if (matched) return matched;
  }

  const { data: bySlug } = await supabase
    .from("events")
    .select(selectFields)
    .eq("slug", slug)
    .eq("status", "published")
    .returns<EventRecord[]>();
  const matched =
    bySlug?.find(
      (item) =>
        item.category === category ||
        (Array.isArray(item.categories) && item.categories.includes(category))
    ) ?? bySlug?.[0];
  if (matched) return matched;

  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const service = createSupabaseServiceClient();
    const { data: serviceData, error: serviceError } = await service
      .from("events")
      .select(selectFields)
      .eq("slug", slug)
      .or(`category.eq.${category},categories.cs.{${category}}`)
      .eq("status", "published")
      .maybeSingle<EventRecord>();
    if (!serviceError && serviceData) return serviceData;
    if (!serviceError && !serviceData) {
      console.warn("[event-detail] not found (service)", {
        category,
        slug,
      });
    }
    if (serviceError) {
      console.warn("[event-detail] query error (service)", serviceError.message);
    }

    const { data: serviceBySlug } = await service
      .from("events")
      .select(selectFields)
      .eq("slug", slug)
      .eq("status", "published")
      .returns<EventRecord[]>();
    const serviceMatched =
      serviceBySlug?.find(
        (item) =>
          item.category === category ||
          (Array.isArray(item.categories) && item.categories.includes(category))
      ) ?? serviceBySlug?.[0];
    if (serviceMatched) return serviceMatched;
  }

  console.warn("[event-detail] not found (final)", { category, slug });
  return null;
};

const getRelatedEvents = async (category: string, excludeId: string) => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("events")
    .select("id, category, slug, title, start_date, venue, flyer_url, image_url")
    .eq("category", category)
    .eq("status", "published")
    .neq("id", excludeId)
    .order("start_date", { ascending: true })
    .limit(3)
    .returns<RelatedEvent[]>();

  return data ?? [];
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
    .select("category, slug, status")
    .eq("id", redirect.to_event_id)
    .maybeSingle();

  if (!target || target.status !== "published") return;
  permanentRedirect(`/events/${target.category}/${target.slug}`);
};

export async function generateMetadata({
  params,
}: {
  params: { category: string; slug: string } | Promise<{ category: string; slug: string }>;
}) {
  const resolvedParams = await Promise.resolve(params);
  const event = await getEvent(resolvedParams.category, resolvedParams.slug);
  const path = `/events/${resolvedParams.category}/${resolvedParams.slug}`;
  if (!event) {
    return buildMetadata({ title: "公演詳細", path });
  }
  const image = event.image_url || event.flyer_url || undefined;
  return buildMetadata({
    title: event.title,
    description: event.description ?? undefined,
    path,
    image,
  });
}

export default async function EventDetailPage({
  params,
}: {
  params: { category: string; slug: string } | Promise<{ category: string; slug: string }>;
}) {
  const resolvedParams = await Promise.resolve(params);
  const event = await getEvent(resolvedParams.category, resolvedParams.slug);

  if (!event) {
    await tryRedirect(resolvedParams.category, resolvedParams.slug);
    notFound();
  }
  if (event.category !== resolvedParams.category) {
    permanentRedirect(`/events/${event.category}/${event.slug}`);
  }

  const categoryCopy = CATEGORY_COPY[event.category] ?? {
    label: event.category,
    icon: "🎟️",
  };
  const siteUrl = getSiteUrl();
  const start = formatDate(event.start_date);
  const end = formatDate(event.end_date);
  const dateLabel = end ? `${start} 〜 ${end}` : start;
  const image = event.image_url || event.flyer_url;
  const scheduleTimes = Array.isArray(event.schedule_times)
    ? event.schedule_times
    : [];
  const ticketTypes = Array.isArray(event.ticket_types)
    ? event.ticket_types
    : [];
  const related = await getRelatedEvents(event.category, event.id);

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
      item: `${siteUrl}/events/${event.category}/`,
    },
    {
      "@type": "ListItem",
      position: 4,
      name: event.title,
      item: `${siteUrl}/events/${event.category}/${event.slug}`,
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
    image: image ? [image] : undefined,
    organizer: {
      "@type": "Organization",
      name: event.company,
    },
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
            <span className="px-1 text-zinc-500">→</span>
          </li>
          <li>
            <Link href="/events" className="badge-retro bg-surface">
              公演一覧
            </Link>
          </li>
          <li>
            <span className="px-1 text-zinc-500">→</span>
          </li>
          <li>
            <Link
              href={`/events/${event.category}`}
              className="badge-retro bg-surface"
            >
              <span aria-hidden>{categoryCopy.icon}</span>
              {categoryCopy.label}
            </Link>
          </li>
          <li>
            <span className="px-1 text-zinc-500">→</span>
          </li>
          <li className="max-w-full rounded-full border-2 border-ink bg-primary px-3 py-1 text-[11px] font-black leading-tight break-words">
            {event.title}
          </li>
        </ol>
      </nav>

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
            <span className="badge-retro bg-surface-muted max-w-full whitespace-normal break-all text-[11px]">
              <span className="font-mono">/{event.category}/{event.slug}</span>
            </span>
          </div>

          <h1 className="mt-4 font-display text-2xl font-normal leading-tight tracking-tight text-ink sm:text-3xl md:text-4xl">
            {event.title}
          </h1>
          <p className="mt-2 text-base font-semibold text-zinc-800">
            {event.company}
          </p>

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
                    return (
                      <div key={`schedule-${index}`} className="flex flex-wrap gap-2">
                        <span className="badge-retro bg-surface-muted">{main}</span>
                        {note && (
                          <span className="text-[11px] text-zinc-600">{note}</span>
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
            {event.ticket_url && (
              <div>
                <span className="font-semibold">チケット:</span>{" "}
                <a
                  className="link-retro"
                  href={event.ticket_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  購入ページへ
                </a>
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
          {image ? (
            <Image
              src={image}
              alt={event.title}
              width={800}
              height={1000}
              unoptimized
              className="h-full w-full bg-surface object-cover"
            />
          ) : (
            <div className="flex h-80 items-center justify-center bg-surface text-sm text-zinc-600">
              画像は未登録です
            </div>
          )}
        </div>
      </div>

      {event.description && (
        <div className="card-retro mt-10 p-6">
          <h2 className="font-display text-xl font-black">あらすじ</h2>
          <p className="mt-3 whitespace-pre-wrap break-words text-base leading-relaxed text-zinc-800">
            {event.description}
          </p>
        </div>
      )}

      {event.cast && event.cast.length > 0 && (
        <div className="card-retro mt-8 p-6">
          <h2 className="font-display text-xl font-black">キャスト</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {event.cast.map((member, index) => (
              <div
                key={`${member.name ?? "cast"}-${index}`}
                className="rounded-xl border-2 border-ink bg-surface p-4 shadow-hard-sm"
              >
                <div className="font-bold">{member.name ?? "名称未設定"}</div>
                {member.role && (
                  <div className="mt-1 text-sm text-zinc-700">{member.role}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {related.length > 0 && (
        <div className="mt-10">
          <h2 className="font-display text-xl font-black">関連の公演</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {related.map((item) => {
              const thumb = item.image_url || item.flyer_url;
              return (
                <Link
                  key={item.id}
                  href={`/events/${item.category}/${item.slug}`}
                  className="card-retro block overflow-hidden transition-transform hover:-translate-y-0.5"
                >
                  <div className="aspect-[4/3] bg-surface-muted">
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={item.title}
                        width={800}
                        height={600}
                        unoptimized
                        className="h-full w-full object-cover"
                      />
                    ) : null}
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
        <h2 className="font-display text-xl font-black">
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
            ログイン / 登録
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

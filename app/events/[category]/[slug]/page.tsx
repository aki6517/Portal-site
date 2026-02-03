import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import ViewCounter from "./ViewCounter";

type EventRecord = {
  id: string;
  title: string;
  company: string;
  description: string | null;
  category: string;
  slug: string;
  start_date: string;
  end_date: string | null;
  venue: string | null;
  venue_address: string | null;
  price_general: number | null;
  price_student: number | null;
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

const SITE_NAME = "福岡アクトポータル";

const getSiteUrl = () => {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl}`;
  return "http://localhost:3000";
};

const CATEGORY_COPY: Record<string, { label: string; icon: string }> = {
  comedy: { label: "コメディ", icon: "😂" },
  conversation: { label: "会話劇", icon: "💬" },
  musical: { label: "ミュージカル", icon: "🎵" },
  classic: { label: "古典・時代劇", icon: "🏯" },
  dance: { label: "ダンス", icon: "💃" },
  student: { label: "学生演劇", icon: "🎓" },
  conte: { label: "コント", icon: "🎭" },
  experimental: { label: "実験的", icon: "🔬" },
  other: { label: "その他", icon: "📌" },
};

const formatDate = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const getEvent = async (category: string, slug: string) => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, title, company, description, category, slug, start_date, end_date, venue, venue_address, price_general, price_student, tags, image_url, flyer_url, ticket_url, cast"
    )
    .eq("category", category)
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle<EventRecord>();

  if (error || !data) return null;
  return data;
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
  params: { category: string; slug: string };
}) {
  const event = await getEvent(params.category, params.slug);
  if (!event) {
    return {
      title: `公演詳細 | ${SITE_NAME}`,
    };
  }
  return {
    title: `${event.title} | ${SITE_NAME}`,
    description: event.description ?? undefined,
  };
}

export default async function EventDetailPage({
  params,
}: {
  params: { category: string; slug: string };
}) {
  const event = await getEvent(params.category, params.slug);

  if (!event) {
    await tryRedirect(params.category, params.slug);
    notFound();
  }

  const categoryCopy = CATEGORY_COPY[event.category] ?? {
    label: event.category,
    icon: "🎟️",
  };
  const siteUrl = getSiteUrl();
  const start = formatDate(event.start_date);
  const end = formatDate(event.end_date);
  const dateLabel = end ? `${start} 〜 ${end}` : start;
  const image = event.flyer_url || event.image_url;
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
    <div className="mx-auto max-w-6xl px-4 py-10">
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
          <li className="badge-retro bg-primary">{event.title}</li>
        </ol>
      </nav>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="card-retro p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge-retro bg-secondary">
              <span aria-hidden>{categoryCopy.icon}</span>
              {categoryCopy.label}
            </span>
            <span className="badge-retro bg-surface-muted">
              <span className="font-mono">/{event.category}/{event.slug}</span>
            </span>
          </div>

          <h1 className="mt-4 font-display text-3xl font-black leading-tight md:text-4xl">
            {event.title}
          </h1>
          <p className="mt-2 text-sm font-semibold text-zinc-800">
            {event.company}
          </p>

          <div className="mt-5 grid gap-3 text-sm">
            <div>
              <span className="font-semibold">開催日時:</span> {dateLabel}
            </div>
            {event.venue && (
              <div>
                <span className="font-semibold">会場:</span> {event.venue}
              </div>
            )}
            {event.venue_address && (
              <div>
                <span className="font-semibold">住所:</span>{" "}
                {event.venue_address}
              </div>
            )}
            {(event.price_general || event.price_student) && (
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
                  className="badge-retro bg-surface-muted"
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
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-800">
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
                  <div className="mt-1 text-xs text-zinc-700">{member.role}</div>
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
              const thumb = item.flyer_url || item.image_url;
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
        <p className="mt-2 text-sm text-zinc-800">
          ログイン後に劇団情報を入力すると、公演の作成・編集ができます。
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
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

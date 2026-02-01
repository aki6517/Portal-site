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

const SITE_NAME = "福岡アクトポータル";

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

  const start = formatDate(event.start_date);
  const end = formatDate(event.end_date);
  const dateLabel = end ? `${start} 〜 ${end}` : start;
  const image = event.flyer_url || event.image_url;

  const startIso = event.start_date;
  const endIso = event.end_date ?? event.start_date;
  const breadcrumbs = [
    {
      "@type": "ListItem",
      position: 1,
      name: "トップ",
      item: "https://portal.galapagos-dynamos.com/",
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "公演一覧",
      item: "https://portal.galapagos-dynamos.com/events/",
    },
    {
      "@type": "ListItem",
      position: 3,
      name: event.category,
      item: `https://portal.galapagos-dynamos.com/events/${event.category}/`,
    },
    {
      "@type": "ListItem",
      position: 4,
      name: event.title,
      item: `https://portal.galapagos-dynamos.com/events/${event.category}/${event.slug}`,
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
    <div className="mx-auto max-w-5xl px-4 py-10">
      <ViewCounter category={event.category} slug={event.slug} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <nav className="text-xs text-zinc-500">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/" className="hover:underline">
              トップ
            </Link>
          </li>
          <li>/</li>
          <li>
            <Link href="/events" className="hover:underline">
              公演一覧
            </Link>
          </li>
          <li>/</li>
          <li>
            <Link
              href={`/events/${event.category}`}
              className="hover:underline"
            >
              {event.category}
            </Link>
          </li>
          <li>/</li>
          <li className="text-zinc-800">{event.title}</li>
        </ol>
      </nav>

      <div className="mt-6 grid gap-6 md:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="text-xs text-zinc-500">
            {event.category} / {event.slug}
          </p>
          <h1 className="mt-2 text-3xl font-bold">{event.title}</h1>
          <p className="mt-2 text-sm text-zinc-600">{event.company}</p>

          <div className="mt-4 space-y-2 text-sm text-zinc-700">
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
                  className="text-zinc-900 underline"
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
                  className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          {image ? (
            <Image
              src={image}
              alt={event.title}
              width={800}
              height={1000}
              unoptimized
              className="w-full rounded-xl border border-zinc-200 object-cover"
            />
          ) : (
            <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-zinc-200 text-sm text-zinc-400">
              画像は未登録です
            </div>
          )}
        </div>
      </div>

      {event.description && (
        <div className="mt-10 rounded-xl border border-zinc-200 bg-white p-6">
          <h2 className="text-lg font-semibold">あらすじ</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-700">
            {event.description}
          </p>
        </div>
      )}

      {event.cast && event.cast.length > 0 && (
        <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6">
          <h2 className="text-lg font-semibold">キャスト</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {event.cast.map((member, index) => (
              <div
                key={`${member.name ?? "cast"}-${index}`}
                className="rounded-md border border-zinc-200 p-3 text-sm"
              >
                <div className="font-medium">{member.name ?? "名称未設定"}</div>
                {member.role && (
                  <div className="text-xs text-zinc-500">{member.role}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

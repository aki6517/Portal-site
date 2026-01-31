import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type EventRow = {
  id: string;
  title: string;
  category: string;
  slug: string;
  start_date: string;
  end_date: string | null;
};

const SITE_NAME = "福岡アクトポータル";

const formatDateParts = (date: Date, timeZone = "Asia/Tokyo") => {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return { year, month, day, date: `${year}-${month}-${day}` };
};

const toJstDateString = (value?: string | null) => {
  if (!value) return "";
  return formatDateParts(new Date(value)).date;
};

const getMonthParam = (value?: string) => {
  if (value && /^\d{4}-\d{2}$/.test(value)) return value;
  const now = new Date();
  const parts = formatDateParts(now);
  return `${parts.year}-${parts.month}`;
};

const addMonths = (value: string, delta: number) => {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  const parts = formatDateParts(date);
  return `${parts.year}-${parts.month}`;
};

const getMonthDays = (month: string) => {
  const [year, monthNum] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNum, 0).getDate();
  const days: string[] = [];
  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, monthNum - 1, day);
    days.push(formatDateParts(date).date);
  }
  return days;
};

const fetchEventsForMonth = async (month: string) => {
  const [year, monthNum] = month.split("-").map(Number);
  const start = new Date(year, monthNum - 1, 1, 0, 0, 0);
  const end = new Date(year, monthNum, 0, 23, 59, 59);

  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("events")
    .select("id, title, category, slug, start_date, end_date")
    .eq("status", "published")
    .lte("start_date", end.toISOString())
    .or(`end_date.is.null,end_date.gte.${start.toISOString()}`)
    .order("start_date", { ascending: true });

  return (data ?? []) as EventRow[];
};

export async function generateMetadata() {
  return {
    title: `カレンダー | ${SITE_NAME}`,
  };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams?: { month?: string };
}) {
  const month = getMonthParam(searchParams?.month);
  const days = getMonthDays(month);
  const events = await fetchEventsForMonth(month);

  const eventMap = new Map<string, EventRow[]>();
  events.forEach((event) => {
    const start = toJstDateString(event.start_date);
    const end = toJstDateString(event.end_date ?? event.start_date);
    if (!start) return;
    const startIndex = days.indexOf(start);
    const endIndex = days.indexOf(end);
    if (startIndex === -1 && endIndex === -1) return;
    const from = Math.max(0, startIndex === -1 ? 0 : startIndex);
    const to = Math.min(
      days.length - 1,
      endIndex === -1 ? days.length - 1 : endIndex
    );
    for (let i = from; i <= to; i += 1) {
      const key = days[i];
      const list = eventMap.get(key) ?? [];
      list.push(event);
      eventMap.set(key, list);
    }
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">カレンダー</h1>
          <p className="mt-1 text-sm text-zinc-600">
            公演開催日をカレンダーで確認できます。
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/calendar?month=${addMonths(month, -1)}`}
            className="rounded-md border border-zinc-200 px-3 py-1 hover:border-zinc-900"
          >
            前の月
          </Link>
          <span className="rounded-md border border-zinc-200 px-3 py-1">
            {month}
          </span>
          <Link
            href={`/calendar?month=${addMonths(month, 1)}`}
            className="rounded-md border border-zinc-200 px-3 py-1 hover:border-zinc-900"
          >
            次の月
          </Link>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {days.map((day) => (
          <div
            key={day}
            className="rounded-xl border border-zinc-200 p-3 text-sm"
          >
            <div className="text-xs text-zinc-500">{day}</div>
            <div className="mt-2 space-y-1">
              {(eventMap.get(day) ?? []).length === 0 && (
                <div className="text-xs text-zinc-400">公演なし</div>
              )}
              {(eventMap.get(day) ?? []).map((event) => (
                <Link
                  key={`${event.id}-${day}`}
                  href={`/events/${event.category}/${event.slug}`}
                  className="block rounded-md bg-zinc-50 px-2 py-1 text-xs text-zinc-800 hover:bg-zinc-100"
                >
                  {event.title}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

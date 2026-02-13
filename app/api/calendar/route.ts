import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type CalendarEvent = {
  id: string;
  title: string;
  category: string;
  slug: string;
  publish_at?: string | null;
  start_date: string;
  end_date: string | null;
};

const toIso = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const isReleased = (publishAt?: string | null) => {
  if (!publishAt) return true;
  const date = new Date(publishAt);
  if (Number.isNaN(date.getTime())) return true;
  return date.getTime() <= Date.now();
};

export async function GET(req: NextRequest) {
  const startParam = req.nextUrl.searchParams.get("start") ?? "";
  const endParam = req.nextUrl.searchParams.get("end") ?? "";
  const startIso = toIso(startParam);
  const endIso = toIso(endParam);

  if (!startIso || !endIso) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "start/end are required" } },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("events")
    .select("id, title, category, slug, publish_at, start_date, end_date")
    .eq("status", "published")
    .lte("start_date", endIso)
    .or(`end_date.is.null,end_date.gte.${startIso}`)
    .order("start_date", { ascending: true });

  let rows = (data ?? []) as CalendarEvent[];
  const missingColumns =
    !!error &&
    (error.message.includes("column") || error.message.includes("does not exist"));
  if (missingColumns) {
    const fallback = await supabase
      .from("events")
      .select("id, title, category, slug, start_date, end_date")
      .eq("status", "published")
      .lte("start_date", endIso)
      .or(`end_date.is.null,end_date.gte.${startIso}`)
      .order("start_date", { ascending: true });
    if (fallback.error) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: fallback.error.message } },
        { status: 500 }
      );
    }
    rows = (fallback.data ?? []) as CalendarEvent[];
  } else if (error) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: error.message } },
      { status: 500 }
    );
  }

  const events = rows
    .filter((event) => isReleased(event.publish_at))
    .map((event: CalendarEvent) => ({
      id: event.id,
      title: event.title,
      start: event.start_date,
      end: event.end_date,
      url: `/events/${event.category}/${event.slug}`,
    }));

  return NextResponse.json({ data: { events } });
}

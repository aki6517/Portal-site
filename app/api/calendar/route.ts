import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type CalendarEvent = {
  id: string;
  title: string;
  category: string;
  slug: string;
  start_date: string;
  end_date: string | null;
};

const toIso = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
    .select("id, title, category, slug, start_date, end_date")
    .eq("status", "published")
    .lte("start_date", endIso)
    .or(`end_date.is.null,end_date.gte.${startIso}`)
    .order("start_date", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: error.message } },
      { status: 500 }
    );
  }

  const events = (data ?? []).map((event: CalendarEvent) => ({
    id: event.id,
    title: event.title,
    start: event.start_date,
    end: event.end_date,
    url: `/events/${event.category}/${event.slug}`,
  }));

  return NextResponse.json({ data: { events } });
}

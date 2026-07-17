import { type NextRequest, NextResponse } from "next/server";

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const CALENDAR_RANGE_WEEKS = 52;
const WEEK_RANGE_MS = CALENDAR_RANGE_WEEKS * 7 * DAY_MS;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const startOfWeekMs = (dateMs: number) => {
  const date = new Date(dateMs);
  const diffFromMonday = (date.getUTCDay() + 6) % 7;
  return dateMs - diffFromMonday * DAY_MS;
};

const parseWeekStartMs = (value: string) => {
  const match = YMD_RE.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dateMs = Date.UTC(year, month - 1, day);
  const date = new Date(dateMs);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return startOfWeekMs(dateMs);
};

const getCurrentWeekStartMs = (now = new Date()) => {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const todayMs = Date.UTC(
    jstNow.getUTCFullYear(),
    jstNow.getUTCMonth(),
    jstNow.getUTCDate()
  );
  return startOfWeekMs(todayMs);
};

export function proxy(request: NextRequest) {
  const week = request.nextUrl.searchParams.get("week");
  if (!week) return NextResponse.next();

  const requestedWeekStartMs = parseWeekStartMs(week);
  if (requestedWeekStartMs === null) return NextResponse.next();

  const currentWeekStartMs = getCurrentWeekStartMs();
  const isOutsideRange =
    requestedWeekStartMs < currentWeekStartMs - WEEK_RANGE_MS ||
    requestedWeekStartMs > currentWeekStartMs + WEEK_RANGE_MS;

  if (!isOutsideRange) return NextResponse.next();

  return NextResponse.redirect(new URL("/calendar", request.url), 308);
}

export const config = {
  matcher: [
    {
      source: "/calendar",
      has: [{ type: "query", key: "week" }],
    },
  ],
};

import CalendarClient from "./CalendarClient";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata() {
  return buildMetadata({
    title: "カレンダー",
    description: "公演開催日をカレンダーで確認できます。",
    path: "/calendar",
  });
}

export default function CalendarPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="card-retro p-6 md:p-8">
        <span className="badge-retro bg-pop-green shadow-hard-sm text-[11px]">
          CALENDAR
        </span>
        <h1 className="mt-3 font-display text-3xl tracking-tight md:text-4xl">
          カレンダーで公演を探す
        </h1>
        <p className="mt-2 text-sm text-zinc-700">
          公演開催日をカレンダーで確認できます。
        </p>
      </div>
      <div className="mt-6">
        <CalendarClient />
      </div>
    </div>
  );
}

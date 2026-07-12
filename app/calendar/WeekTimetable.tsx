import Link from "next/link";
import { getReadableTextColor } from "@/lib/color";
import {
  buildCalendarHref,
  isJstToday,
  shiftWeekIso,
  type TimetableArea,
  type TimetableEventBand,
} from "@/lib/data/calendar";

// サーバーレンダリングの「会場×週」番組表本体。FullCalendarは使わず、
// CSS Gridのみで組む（JSの到着を待たずにHTMLの時点で帯が見えるのが目的）。
// RSC（"use client"は使わない）。全リンクはURLの?week=/?cat=遷移のみで完結する。
//
// PC版（md以上）は会場列(1列目)+7列(2〜8列目)の単一グリッド。
// モバイル版（md未満）は会場列を廃止し、日付ヘッダーを最上部に1回だけ出したうえで、
// 会場ごとに「会場名の行→その会場の7列グリッド（レーン数分）」を縦積みする構成にして、
// 横スクロールなしで7日分を1画面に収める（オーナー要望：スライド操作をなくす）。

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

const formatDayHeader = (pseudoDate: Date) => {
  const month = pseudoDate.getUTCMonth() + 1;
  const date = pseudoDate.getUTCDate();
  const weekday = WEEKDAY_LABELS[pseudoDate.getUTCDay()];
  return `${month}/${date}(${weekday})`;
};

const dayHeaderClassName = (pseudoDate: Date) => {
  const dow = pseudoDate.getUTCDay();
  if (isJstToday(pseudoDate)) return "bg-pop-yellow/60 font-black";
  if (dow === 6) return "bg-pop-blue/10 font-bold";
  if (dow === 0) return "bg-pop-pink/10 font-bold";
  return "bg-surface-muted font-bold";
};

// モバイル日付ヘッダーの背景（今日のみpop-yellowでハイライト。土日の特別背景はPC版と違い付けない）
const mobileDayHeaderBgClassName = (pseudoDate: Date) =>
  isJstToday(pseudoDate) ? "bg-pop-yellow/60 font-black" : "bg-surface-muted font-bold";

// モバイル日付ヘッダーの曜日文字色（土=青・日=赤。平日はink）
const mobileWeekdayTextClassName = (pseudoDate: Date) => {
  const dow = pseudoDate.getUTCDay();
  if (dow === 6) return "text-blue-600";
  if (dow === 0) return "text-red-600";
  return "text-ink";
};

type GridItem =
  | { kind: "areaHeading"; row: number; label: string }
  | { kind: "venueName"; row: number; rowSpan: number; name: string }
  | { kind: "band"; row: number; band: TimetableEventBand };

const buildGridItems = (areas: TimetableArea[]): GridItem[] => {
  const items: GridItem[] = [];
  let row = 2; // 1行目はヘッダ（曜日）
  for (const area of areas) {
    items.push({ kind: "areaHeading", row, label: area.label });
    row += 1;
    for (const venue of area.venues) {
      const laneCount = Math.max(venue.lanes.length, 1);
      items.push({ kind: "venueName", row, rowSpan: laneCount, name: venue.name });
      venue.lanes.forEach((lane, laneIndex) => {
        lane.forEach((band) => {
          items.push({ kind: "band", row: row + laneIndex, band });
        });
      });
      row += laneCount;
    }
  }
  return items;
};

// モバイル版の公演帯1件（会場の7列グリッド内。1日幅では色が主役になるよう
// タイトルはtruncateし、ホール注記は省略してタップターゲットを確保する）
const MobileEventBand = ({ band }: { band: TimetableEventBand }) => {
  const textColor = getReadableTextColor(band.color);
  return (
    <Link
      href={`/events/${encodeURIComponent(band.event.category)}/${encodeURIComponent(band.event.slug)}`}
      title={band.event.title}
      className="m-0.5 flex min-h-9 min-w-0 items-center gap-1 rounded-md border-2 border-ink px-1.5 shadow-hard-sm"
      style={{
        // band.colStart/colEndはPC版（会場列ぶん+1された2〜8列基準）の値なので、
        // 会場列を持たないモバイルの7列グリッド（1〜7列基準）に合わせて1引く
        gridColumn: `${band.colStart - 1} / ${band.colEnd}`,
        backgroundColor: band.color,
        color: textColor,
      }}
    >
      {band.continuesBefore && <span aria-hidden>◀</span>}
      <span className="truncate text-xs font-black leading-tight">{band.event.title}</span>
      {band.continuesAfter && <span aria-hidden>▶</span>}
    </Link>
  );
};

type WeekTimetableProps = {
  weekStartIso: string;
  activeCategory: string;
  days: Date[];
  areas: TimetableArea[];
};

export default function WeekTimetable({
  weekStartIso,
  activeCategory,
  days,
  areas,
}: WeekTimetableProps) {
  if (areas.length === 0) {
    const nextWeekIso = shiftWeekIso(weekStartIso, 1);
    return (
      <div className="card-retro p-6 text-sm text-zinc-700">
        この週はまだ公演情報がありません。次の週もチェックしてみてくださいね。
        <div className="mt-4">
          <Link href={buildCalendarHref(nextWeekIso, activeCategory)} className="btn-retro btn-ink">
            次の週を見る →
          </Link>
        </div>
      </div>
    );
  }

  const items = buildGridItems(areas);
  const todayColIndex = days.findIndex((day) => isJstToday(day));

  return (
    <>
      {/* ==================== モバイル版（md未満）：会場列を廃止し、7日分を横スクロールなしで1画面に ==================== */}
      <div className="card-retro overflow-hidden p-0 md:hidden" role="table" aria-label="週間公演番組表">
        {/* 日付ヘッダー（最上部に1回・2段表記） */}
        <div
          className="grid border-b-2 border-ink"
          style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
        >
          {days.map((day, index) => (
            <div
              key={day.toISOString()}
              className={`flex flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 ${mobileDayHeaderBgClassName(day)}`}
              style={{ gridColumn: index + 1 }}
            >
              <span className={`text-xs font-bold leading-none ${mobileWeekdayTextClassName(day)}`}>
                {WEEKDAY_LABELS[day.getUTCDay()]}
              </span>
              <span className="text-xs font-black leading-none">{day.getUTCDate()}</span>
            </div>
          ))}
        </div>

        {areas.map((area) => (
          <div key={`mobile-area-${area.label}`}>
            <div className="border-b-2 border-ink bg-ink-muted px-3 py-1.5 text-xs font-black tracking-wide text-white">
              {area.label}
            </div>
            {area.venues.map((venue) => (
              <div key={`mobile-venue-${area.label}-${venue.name}`} className="border-t-2 border-ink">
                <div className="bg-surface px-2 py-1 text-xs font-bold text-ink">{venue.name}</div>
                {venue.lanes.map((lane, laneIndex) => (
                  <div
                    key={`mobile-lane-${area.label}-${venue.name}-${laneIndex}`}
                    className="grid"
                    style={{
                      gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                      gridAutoRows: "minmax(2.25rem, auto)",
                    }}
                  >
                    {todayColIndex >= 0 && (
                      <div
                        aria-hidden
                        className="pointer-events-none bg-pop-yellow/15"
                        style={{ gridColumn: `${todayColIndex + 1} / ${todayColIndex + 2}`, gridRow: "1 / -1" }}
                      />
                    )}
                    {lane.map((band) => (
                      <MobileEventBand key={band.event.id} band={band} />
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ==================== PC版（md以上）：既存の会場列+7列グリッドをそのまま維持 ==================== */}
      <div className="card-retro hidden overflow-x-auto p-0 md:block" role="table" aria-label="週間公演番組表">
        <div
          className="grid"
          style={{
            gridTemplateColumns: "minmax(88px, 160px) repeat(7, minmax(96px, 1fr))",
            gridAutoRows: "minmax(2.75rem, auto)",
          }}
        >
          {/* 今日の列の全体ハイライト（先頭に置いて他セルの背後に描画させる） */}
          {todayColIndex >= 0 && (
            <div
              aria-hidden
              className="pointer-events-none bg-pop-yellow/15"
              style={{ gridColumn: `${todayColIndex + 2} / ${todayColIndex + 3}`, gridRow: "1 / -1" }}
            />
          )}

          {/* ヘッダ行 */}
          <div
            className="sticky left-0 z-10 flex items-center border-b-2 border-r-2 border-ink bg-surface-muted px-2 py-2 text-xs font-black"
            style={{ gridColumn: 1, gridRow: 1 }}
          >
            会場
          </div>
          {days.map((day, index) => (
            <div
              key={day.toISOString()}
              className={`flex items-center justify-center border-b-2 border-ink px-1 py-2 text-xs ${dayHeaderClassName(day)}`}
              style={{ gridColumn: index + 2, gridRow: 1 }}
            >
              {formatDayHeader(day)}
            </div>
          ))}

          {items.map((item) => {
            if (item.kind === "areaHeading") {
              return (
                <div
                  key={`area-${item.row}`}
                  className="border-b-2 border-ink bg-ink-muted px-3 py-1.5 text-xs font-black tracking-wide text-white"
                  style={{ gridColumn: "1 / -1", gridRow: item.row }}
                >
                  {item.label}
                </div>
              );
            }
            if (item.kind === "venueName") {
              return (
                <div
                  key={`venue-${item.row}`}
                  className="sticky left-0 z-10 flex items-center border-b-2 border-r-2 border-ink bg-surface px-2 py-2"
                  style={{ gridColumn: 1, gridRow: `${item.row} / span ${item.rowSpan}` }}
                >
                  <span className="line-clamp-2 text-xs font-bold leading-snug">{item.name}</span>
                </div>
              );
            }

            const { band } = item;
            const textColor = getReadableTextColor(band.color);
            return (
              <Link
                key={band.event.id}
                href={`/events/${encodeURIComponent(band.event.category)}/${encodeURIComponent(band.event.slug)}`}
                title={band.event.title}
                className="m-0.5 flex min-w-0 flex-col justify-center gap-0.5 rounded-lg border-2 border-ink px-2 py-1 shadow-hard-sm transition-transform hover:-translate-y-0.5"
                style={{
                  gridColumn: `${band.colStart} / ${band.colEnd + 1}`,
                  gridRow: item.row,
                  backgroundColor: band.color,
                  color: textColor,
                }}
              >
                <span className="flex min-w-0 items-center gap-1 text-xs font-black leading-tight">
                  {band.continuesBefore && <span aria-hidden>◀</span>}
                  <span className="truncate">{band.event.title}</span>
                  {band.continuesAfter && <span aria-hidden>▶</span>}
                </span>
                {band.hallNote && (
                  <span className="truncate text-xs font-normal leading-tight">{band.hallNote}</span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}

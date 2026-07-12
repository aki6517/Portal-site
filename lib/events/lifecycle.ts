// 公演の「終了状態」を判定する共通関数。
// Phase 1（一覧からの過去公演除外）と Phase 4（SEOのnoindex制御）の両方から使う。

type ScheduleTimeLike = {
  start_date?: string | null;
  end_date?: string | null;
  label?: string | null;
};

export type LifecycleEvent = {
  start_date?: string | null;
  end_date?: string | null;
  schedule_times?: ScheduleTimeLike[] | null;
};

const toTime = (value?: string | null): number | null => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

/**
 * 公演の実質的な終了日時（epoch ms）を返す。
 * schedule_times（複数日程）の最終日時 / end_date / start_date のうち
 * 取得できる最大の日時を採用する。どれも無ければ null。
 */
export const getEffectiveEnd = (event: LifecycleEvent): number | null => {
  const candidates: number[] = [];

  if (Array.isArray(event.schedule_times)) {
    event.schedule_times.forEach((item) => {
      const end = toTime(item?.end_date) ?? toTime(item?.start_date);
      if (end !== null) candidates.push(end);
    });
  }

  const endDate = toTime(event.end_date);
  if (endDate !== null) candidates.push(endDate);

  const startDate = toTime(event.start_date);
  if (startDate !== null) candidates.push(startDate);

  if (candidates.length === 0) return null;
  return Math.max(...candidates);
};

/** 実質的な終了日時を過ぎていれば true（終了日時が不明な場合は false = 終了扱いしない）。 */
export const isEnded = (event: LifecycleEvent, now: Date = new Date()): boolean => {
  const effectiveEnd = getEffectiveEnd(event);
  if (effectiveEnd === null) return false;
  return effectiveEnd < now.getTime();
};

const NOINDEX_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 終演+7日

/** 終演から7日を超えていればnoindex対象。 */
export const shouldNoindex = (event: LifecycleEvent, now: Date = new Date()): boolean => {
  const effectiveEnd = getEffectiveEnd(event);
  if (effectiveEnd === null) return false;
  return now.getTime() - effectiveEnd > NOINDEX_GRACE_MS;
};

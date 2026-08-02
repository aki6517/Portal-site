-- トップページの「編集部おすすめ（PICK UP固定）」用。
-- featured_at が設定された公開中イベントを、トレンド1位より優先してヒーローに表示する。
-- 複数設定時は featured_at が新しいものを採用。NULL = 固定なし（従来どおりPV順）。
alter table public.events
  add column if not exists featured_at timestamptz;

comment on column public.events.featured_at is
  'トップのPICK UP枠に固定表示する指定日時。NULLなら固定なし。複数ある場合は最新を採用';

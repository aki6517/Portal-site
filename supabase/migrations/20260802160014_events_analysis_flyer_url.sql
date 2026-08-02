-- AI解析専用のチラシ画像を、公開表示用のflyer_urlと分離して保持する。
alter table public.events
  add column if not exists analysis_flyer_url text;

comment on column public.events.analysis_flyer_url is
  'AI解析専用のチラシ画像URL（裏面など）。公開表示には使わない';

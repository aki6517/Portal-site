# docs/sql について

## 1. このフォルダの位置付け

- **本番に流すのは `supabase/migrations/`**（`supabase db push --linked` で、まだ入っていないファイルだけが流れる）
- `docs/sql/` は、DB の土台（`001`〜`004`）と、`supabase/migrations/` の一部の写し
- 例外として `006`・`007` は `docs/sql/` にだけあり、`supabase/migrations/` には無い（下の表）
- 写しは中身が同じ（`008` だけ、先頭のコメントが違う）。写しを直すときは `supabase/migrations/` 側を正本にする

## 2. 空の DB を作る順番

1. `docs/sql/001_init.sql`（表・関数・トリガー・RLS の土台）
2. `docs/sql/002_seed_sample.sql`（サンプルの劇団・会場・公演。**任意**）
3. `docs/sql/003_update_theater_rules.sql`（劇団の既定 status を approved に・劇団名の重複禁止・`theater_invites`）
4. `docs/sql/004_site_settings.sql`（`site_settings`）
5. `docs/sql/006_events_multivalue_fields.sql`・`docs/sql/007_events_staff_fields.sql`（`supabase/migrations/` に無いので手で流す）
6. `supabase/migrations/` を古い順にすべて（`supabase db push` か、SQL Editor でファイル名の順に）

`docs/sql/` の `005`・`008`〜`011`・`018`〜`021` は `supabase/migrations/` の写しなので、6 で流れる（二重に流す必要はない）。

**リポジトリの SQL では作られないもの**（空の DB では別に用意が要る）:
- `user_settings` 表（選択中の劇団。`lib/theater/activeTheater.ts` が読み書きする）
- `categories` の `action`・`drama`・`serious` の行（`001_init.sql` の初期データは 9 件。劇団の公演フォーム `app/theater/events/_components/EventForm.tsx` の選択肢は 12 件）

## 3. 番号ごとの対応

| 番号 | `docs/sql/` | `supabase/migrations/` |
|------|-------------|------------------------|
| 001 | `001_init.sql`（土台） | なし |
| 002 | `002_seed_sample.sql`（サンプル・任意） | なし |
| 003 | `003_update_theater_rules.sql`（土台） | なし |
| 004 | `004_site_settings.sql`（土台） | なし |
| 005 | `005_events_publish_reservation.sql`（写し） | `20260712120005_events_publish_reservation.sql` |
| 006 | `006_events_multivalue_fields.sql` | **なし** |
| 007 | `007_events_staff_fields.sql` | **なし** |
| 008 | `008_trending_rpc.sql`（写し・先頭のコメントだけ違う） | `20260712130008_trending_rpc.sql` |
| 009 | `009_venues_area.sql`（写し） | `20260712150009_venues_area.sql` |
| 009b | `009b_categories_colors.sql`（写し） | `20260712151000_categories_colors.sql` |
| 010 | `010_events_superseded.sql`（写し） | `20260712170010_events_superseded.sql` |
| 011 | `011_scout_fields.sql`（写し） | `20260712180011_scout_fields.sql` |
| 012 | **なし** | `20260802100012_events_featured_at.sql` |
| 013 | なし | なし（欠番） |
| 014 | **なし** | `20260802160014_events_analysis_flyer_url.sql` |
| 015 | **なし** | `20260802180015_harvest_infra.sql` |
| 016 | **なし** | `20260802210016_venue_area_adjust.sql` |
| 017 | **なし** | `20260802220017_bayside_alias.sql` |
| 018 | `018_lock_down_self_join_and_theater_insert.sql`（写し） | `20261127120018_lock_down_self_join_and_theater_insert.sql` |
| 019 | `019_theater_invites_admin_only.sql`（写し） | `20261127130019_theater_invites_admin_only.sql` |
| 020 | `020_events_writes_admin_only.sql`（写し） | `20261127140020_events_writes_admin_only.sql` |
| 021 | `021_event_view_dedupe.sql`（写し） | `20261127150021_event_view_dedupe.sql` |

### 3.1 写しの無い番号（`supabase/migrations/` にだけある）
- `012`・`014`・`015`・`016`・`017`（中身は `supabase/migrations/` のファイルを見る）

### 3.2 `supabase/migrations/` に無い番号（`docs/sql/` にだけある）
- `001`〜`004`（土台）、`006`・`007`

## 4. 注意

- `001_init.sql` のポリシーには、あとのファイルで消したり置き換えたりしたものが残っている（例: `theater_members` の自己登録・`theaters` の作成・`events` の書き込み・`promotions`）。今のポリシーは `docs/03_database.md` の「6. Row Level Security (RLS)」を見る
- 新しいマイグレーションは `supabase/migrations/` に作る（ファイル名の末尾の番号は、既存の最後の番号の続き）

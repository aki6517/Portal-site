---
name: portal-scout
description: 福岡アクトポータルの学生演劇（大学演劇部・高校演劇・学生プロデュース公演）をWeb検索で収集し、Supabaseにdraftとして自動登録するスキル。公開は絶対に行わず、必ず人間のadmin画面レビューを経由する。「学生演劇スカウト」「ポータルに学生演劇を収集」で発動
---

# Portal Site 学生演劇スカウトスキル

## 目的

福岡県内の学生演劇（大学演劇部・高校演劇・学生プロデュース公演）の公演情報をWeb検索で収集し、
**draft（下書き）としてのみ**Supabaseに登録する。**公開（status='published'）は絶対にしない** — 必ず
`/admin/events`（`app/admin/events/page.tsx`）で人間がレビューし、公開/却下を判断する。

このスキルは「収集して溜める」ところまでが仕事。判断・公開は人間の仕事。

## 前提情報

- プロジェクトパス: `~/Desktop/Portal site/fukuoka-stage---night's-coffee/`（スペース+アポストロフィを含むため、シェルでは必ずダブルクォートで囲む）
- Supabase接続情報は `.env.local` にある。値は直接会話に貼らず、シェル変数として読み込んで使う
- 運営連絡先メール: `pugwriting@gmail.com`（scoutで新規作成する劇団の `contact_email` に使う）
- レビュー画面: `https://portal.galapagos-dynamos.com/admin/events`
- 関連テーブル（`docs/sql/001_init.sql` + `docs/sql/011_scout_fields.sql`）
  - `theaters`: `origin`（'self' | 'scout'。scoutは今回追加）、`status`（pending/approved/rejected/suspended）、`name` に **大文字小文字無視の一意制約**あり（`uniq_theaters_name_ci`）
  - `events`: `status`（draft/published/archived）、`category`（`categories`テーブルのid。学生演劇は `'student'`）、`categories`（TEXT[]、複数タグ）、`ai_confidence`（0〜1のfloat）、`source_urls`（TEXT[]、今回追加）、`slug`は `(category, slug)` で一意
- venue正規化のロジックは `lib/venues/normalize.ts`（NFKC正規化→括弧除去→ホール接尾辞分離→`venues.name`/`aliases`と照合）。このスキルではDB書き込み時に `venue_id` を無理に解決しなくてよい（下記「venueの扱い」参照）

## 手順

### (1) Web検索で収集

`WebSearch` で候補を探す。クエリ例:
- 「福岡 大学 演劇部 公演 2026」
- 「高校演劇 福岡県大会」
- 「九州大学 演劇 公演」
- 「西南学院大学 演劇部」
- 「福岡大学 演劇部 公演」「久留米大学 演劇」等、大学名を変えて横展開
- 「福岡 学生演劇 チケット」（Teket・カンフェティ等のチケットサイトも情報源になる）

大学名は例示であり実在確認はしていない。検索結果に公式アカウント・公式サイトが見つかった団体だけを対象にする（存在しない団体を推測で作らない）。

### (1b) SNS収集（Chrome経由・大学演劇部はこれが本命）

大学演劇部の公演告知はほぼ**公式X/Instagramの中だけ**で行われる（各部のWebサイトは更新停止が常態。2026-07-13の初回運用で確認済み）。WebFetchではX/Instagramは読めない（403/JSウォール）ため、**claude-in-chrome（ユーザーのログイン済みChrome）で直接開いて読む**:

1. `tabs_context_mcp`→新規タブ作成→`navigate`で `https://x.com/<アカウント>` を開く
2. `get_page_text`でタイムライン本文を抽出（最初は固定ポストと最新数件しか取れないので、`scroll`+再取得を2〜3回）
3. 公演フライヤー画像に作品タイトル・日程が書かれていることが多い → `computer`の`zoom`で画像領域を拡大して判読する（作者名など小さい文字はOCR誤読リスクがあるため、確信が持てない固有名詞は登録に含めない）
4. 出典URL: 個別ポストのURLが取れればベスト、取れなければアカウントURL（例 `https://x.com/kyu_en`）+投稿日をdescriptionや報告に明記
5. **操作は閲覧のみ**。フォロー・いいね・リポスト・返信・投稿は絶対にしない

**ウォッチ対象アカウント（2026-07時点・見つけ次第追記）:**
- `@kyu_en` — 九州大学演劇部（伊都）。年4回公演（新歓4月末・前期7月中旬・秋学祭10月・後期3月）
- `@gek_i_d` — 九州大学大橋キャンパス演劇部（春公演3月等）
- `@FSTFweb` — 福岡学生演劇祭（年1回・大賞は全国学生演劇祭へ。2026年開催は終了済→2027待ち）
- Instagram `@fu_act` — 福岡大学演劇部（6月に本公演の実績）
- Instagram `@seinan_drama_club` / note `seinan_drama` — 西南学院大学演劇部

### (2) 公式情報から抽出

各候補について、以下を公式情報源（公式サイト・公式X/Instagramアカウント・Teket/カンフェティ等の公式チケットページ）から抽出する:

| 項目 | 対応するevents列 | 備考 |
|---|---|---|
| 公演タイトル | `title` | |
| 劇団・団体名 | `company`（＋`theaters.name`） | theaterの`name`と`events.company`は一致させる |
| 開演日 | `start_date` | ISO8601（`+09:00`）で保存 |
| 終演日 | `end_date` | 単日公演は`start_date`と同日でよい |
| 会場 | `venue` | 正式名称のまま文字列で保存（下記「venueの扱い」参照） |
| 料金 | `price_general` / `price_student` | 不明なら省略（NULL） |
| チケットURL | `ticket_url` | |
| 出典URL（複数可） | `source_urls` | 最低1件必須。裏取りに使った全URLを入れる |

### (3) 重複チェック

**3-a. タイトルの正規化**: 記号（『』「」！？　等）と空白を除いた、団体名や年など重複判定に効く短い部分文字列を使う（フルタイトルだと表記ゆれで一致しないことがある）。

**3-b. 公開済みイベントとの重複チェック（anonキー）**: `events` の `status='published'` 行はRLSで誰でも読めるため、anonキーで確認できる。

```bash
ENV_FILE="/Users/nishiyamaakihiro/Desktop/Portal site/fukuoka-stage---night's-coffee/.env.local"
SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | cut -d '=' -f2-)
SUPABASE_ANON_KEY=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' "$ENV_FILE" | cut -d '=' -f2-)

curl -s "${SUPABASE_URL}/rest/v1/events?title=ilike.*正規化タイトル*&start_date=gte.2026-07-09&start_date=lte.2026-07-15&select=id,title,start_date,company,status" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}"
```

（`start_date`の`gte`/`lte`は公演日の±3日を目安に埋める。PostgRESTは同名パラメータを繰り返すとAND条件になる）

**注意（既知の制約）**: anonキーはRLS「Published events are viewable by everyone」により **`status='published'`の行しか見えない**。つまり3-bのチェックは「もう公開されている公演」との重複しか防げず、**まだレビュー待ちのdraft同士の重複は検知できない**。同じ団体を複数回に分けてスカウトする運用では、可能なら3-cのservice roleキー版で`status`を絞らずに確認する方が安全（取りこぼしが心配なければ3-bだけで進めてよいが、最終的な重複解消は人間のadmin画面レビューでも行われる）。

**3-c.（推奨）draft含む全件チェック（service roleキー）**:

```bash
SUPABASE_SERVICE_ROLE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' "$ENV_FILE" | cut -d '=' -f2-)

curl -s "${SUPABASE_URL}/rest/v1/events?title=ilike.*正規化タイトル*&select=id,title,start_date,company,status" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

**3-d. 既存theaters名の一致確認（service roleキー必須）**: `theaters`テーブルには公開向けSELECTポリシーが存在しない（admin本人か劇団メンバー本人しか読めないRLS）。**anonキーで叩くと該当劇団が実在してもRLSにより常に0件になる**ため、必ずservice roleキーを使う。

```bash
curl -s "${SUPABASE_URL}/rest/v1/theaters?name=ilike.*劇団名*&select=id,name,status,origin,contact_email" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

該当行があれば、その`id`を(4)以降で`theater_id`として使う（新規作成しない）。

### (4) 未登録の劇団はtheatersに新規作成（service roleキー）

3-dで見つからなければ新規作成する。`origin='scout'`、`status='approved'`（eventsの公開時にRLSが`theaters.status='approved'`を要求するため）、`contact_email`は運営メール固定。

```bash
curl -s -X POST "${SUPABASE_URL}/rest/v1/theaters" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "name": "劇団名（正式名称）",
    "contact_email": "pugwriting@gmail.com",
    "status": "approved",
    "origin": "scout"
  }'
```

`theaters.name`には大文字小文字無視の一意制約（`uniq_theaters_name_ci`）があるため、3-dのチェック漏れで同名が既にあると **409（重複）** が返る。その場合は3-dのGETをやり直して既存の`id`を使う（新規作成をリトライしない）。

### (5) eventsにdraftとしてINSERT（service roleキー）

**`status`は必ず`"draft"`固定**。`category`は`"student"`固定、`categories`にも`["student"]`を入れる。`ai_confidence`は情報の確からしさ（公式サイト+チケットサイトで裏取りできていれば0.8以上、公式アカウントの投稿のみなら0.5〜0.7目安、断片情報のみなら0.5未満）を0〜1で入れる。

**venueの扱い**: `venue`列には会場の正式名称をそのまま文字列で入れればよい。`venue_id`は省略（NULL）でよい — 公開後、カレンダー番組表（`lib/venues/normalize.ts`のresolveVenue）が`venues.name`/`aliases`と自動照合を試み、一致しなければ「その他の会場」として表示されるだけで、公演の公開自体は妨げない。

**slugの作り方**: 劇団名（ローマ字・ヘボン式ベース）+ 年 + 季節や回次などを`-`区切り・小文字のkebab-caseにする。`(category, slug)`で一意制約があるため、同じ劇団の別公演と衝突しないよう年や時期を必ず含める。
例: 西南学院大学演劇部の2026年夏公演 → `seinan-engekibu-2026-natsu`

```bash
curl -s -X POST "${SUPABASE_URL}/rest/v1/events" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "theater_id": "<(3-d)または(4)で確定したtheaters.id>",
    "category": "student",
    "categories": ["student"],
    "slug": "seinan-engekibu-2026-natsu",
    "title": "第◯回公演『タイトル』",
    "company": "劇団名（theaters.nameと一致させる）",
    "start_date": "2026-08-01T13:00:00+09:00",
    "end_date": "2026-08-03T17:00:00+09:00",
    "venue": "会場の正式名称",
    "ticket_url": "https://...",
    "status": "draft",
    "ai_confidence": 0.75,
    "source_urls": ["https://公式サイトのURL", "https://チケットページのURL"]
  }'
```

`(category, slug)`が衝突すると409が返る。その場合はslug末尾に`-2`等を付けて再送する（既存イベントを上書きしない）。

### (6) レビューURL一覧を出力して終了

登録した下書きのタイトルと、レビュー画面URLを一覧にして出力する（URLは全件共通・単一ページ）。

```
## 学生演劇スカウト結果（実行日）

登録した下書き: N件

1. 劇団名『タイトル』（開演日〜終演日・会場）
   出典: https://..., https://...
2. ...

レビューはこちら: https://portal.galapagos-dynamos.com/admin/events
```

## 禁止事項

- **`status='published'`での直接作成は禁止**。必ず`draft`で作成し、`/admin/events`での人間レビューを経て公開する
- **既存イベント・既存劇団のUPDATEは禁止**。このスキルは新規INSERTのみ行う。修正が必要な既存データは、劇団本人のダッシュボード（`/theater`）かadmin画面で人間が直す
- **出典URLの無い情報の登録は禁止**。`source_urls`が最低1件も無い情報は登録しない
- **個人のSNS投稿のみを根拠にした登録は禁止**。情報源は公式アカウント・公式サイト・公式チケットサイト（Teket/カンフェティ等）に限る。観客・ファン個人の感想ポストなどは根拠にしない

## トラブルシューティング

### `theaters`のPOSTが409を返す
`uniq_theaters_name_ci`（大文字小文字無視の名前一意制約）に抵触している。(3-d)のGETで既存行を再取得し、その`id`を使う。新規作成をリトライしない。

### `events`のPOSTが409を返す
`(category, slug)`の一意制約に抵触している。同じ`category='student'`内でslugが衝突している。slugを（年・回次・末尾連番などで）変えて再送する。

### `theaters`のGETが常に0件になる（劇団が実在するはずなのに）
anonキーで叩いていないか確認する。`theaters`には公開向けSELECTポリシーが無いため、anonキーでは常に0件になる。service roleキーを使う（(3-d)参照）。

### `ai_confidence`のPOSTがエラーになる
`CHECK (ai_confidence >= 0 AND ai_confidence <= 1)`制約がある。0〜1の範囲で入れる（%表記の75ではなく0.75）。

### RLS違反（`new row violates row-level security policy`）
service roleキーではなくanon/authenticatedキーで書き込みしようとしている可能性が高い。`theaters`・`events`へのINSERTは必ずservice roleキー（`SUPABASE_SERVICE_ROLE_KEY`）を使う。

## ドライラン推奨

初回や仕様変更後は、まず1件だけdraft登録 →`/admin/events`で表示・出典リンク・AI確度バッジを目視確認 → 公開ボタンで実際に公開 → 公開ページ・カレンダーに反映されるかをcurlで確認、の順に小さく検証してから複数件をまとめて登録する。

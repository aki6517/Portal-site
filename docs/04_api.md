# API設計書

## 1. 目的と前提

### 1.1 目的
- 劇団ダッシュボード（`/theater/`）・劇団登録（`/register/`）からの **劇団・公演の操作**、AI機能、PV計測、問い合わせ送信を安全に提供する
- 書き込みは、API の中でログイン・所属・権限・入力の形を確かめてから、サーバーだけが持つ `service_role` の鍵で行う。RLS（DB権限）は、ブラウザから公開の anon キーで直接書けないようにする最後の守り（`docs/03_database.md` の「6. Row Level Security (RLS)」）

### 1.2 前提（要件との対応）
- 認証: Supabase Auth（Google OAuth + メールMagic Link）
- 劇団の状態: `theaters.status`。劇団登録（`POST /api/theater/onboard`）は `approved` で作る（即承認）。運営者が `pending`・`rejected`・`suspended` に変えられる。`approved` でない劇団は公演を `published` にできない（403）
- 公演URL: `/events/{category}/{slug}`。`category` は主カテゴリ。`categories`（2つ目からのカテゴリ）は一覧の絞り込み・表示に使うタグで、URLを持たない
- 人気順: 直近30日PV（`event_views_daily` 集計）
- URL変更時: 公開ページに出ていた公演の主カテゴリの組 `(category, slug)` が変わると、旧URLを `event_redirects` に登録する。公開ページは旧URLを **308** で新URLへ転送する

### 1.3 APIの位置付け
- 公開ページはサーバーコンポーネントでDBから直接取得（SEO優先。`lib/data/events.ts`）
- **副作用がある処理**（劇団・公演の保存、AI、PV、旧URLの登録、問い合わせ送信）はAPI経由

---

## 2. 共通仕様

### 2.1 ベースURL
- `https://{domain}/api/*`

### 2.2 認証と権限
- 劇団ユーザー: Supabaseセッション（Cookie）で認証。各APIが `supabase.auth.getUser()` でログインを確かめる
- 所属: `theater_members`。1つのアカウントで複数の劇団に所属できる
  - 操作の対象は「選択中の劇団」（`user_settings.active_theater_id`。未設定・所属外なら最初に所属した劇団）。`/api/theater/active` で切り替える（`lib/theater/activeTheater.ts`）
  - 例外: AI宣伝文の生成（5.2）は、選択中かどうかを問わず「公演の劇団」の所属で判定する
- 役割: `owner`（劇団を登録した人）と `editor`（招待で入った人）
  - 招待・メンバーの一覧と削除は `owner` だけ
  - 公演の作成・編集・削除と劇団情報の編集は、所属メンバーなら役割を問わない
- 運営者: `admins` テーブルで判定（DB関数 `is_admin()`）
- **service_role**: 劇団向けAPIの書き込み、PV集計、旧URLの登録、問い合わせの保存などのサーバー内部処理で使用。運営者向けAPI（`/api/admin/*`）は、`site-tags` 以外はログイン中の利用者のクライアントで書き、RLS の `is_admin()` を通る

### 2.3 レスポンス形式（JSON）
成功（`data` の中身はAPIごと）:
```json
{ "data": { "ok": true } }
```
失敗:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "英小文字（a〜z）・数字・ハイフン（-）だけで入力してください。ハイフンは先頭・末尾・連続では使えません。"
  }
}
```
- 劇団向けのAPI（`/api/theater/*`・`/api/ai/*`・`/api/storage/flyers`）の `message` は、劇団の人が読んで次に何をすればいいか分かる **日本語の文**。画面（`EventForm`・`EditEventScreen`・`/theater`・`/theater/settings`・`/register`）はそのまま表示する
- DBのエラー文は応答に出さず、サーバーのログ（`console.error`）に code・message を残す
- プログラムが分岐に使うのは `error.code` と HTTPステータス。`message` の文言では分岐しない（文言は変わることがある）
- 劇団向け以外のAPI（`/api/views`・`/api/contact`・`/api/admin/*`）の `message` は日本語にそろえていない（英語の文や、DBのエラー文をそのまま返すものがある）

### 2.4 ステータスコード
- `200` OK
- `201` Created
- `400` Validation Error（入力の不足・形式違反・本文がJSONでない）
- `401` Unauthorized（ログインしていない）
- `403` Forbidden（劇団に所属していない・オーナーだけの操作・承認済みでない劇団の公開・ほかの劇団の公演の宣伝文）
- `404` Not Found
- `409` Conflict（URLの重複・ほかの公演の旧URL・同名の劇団・招待の上限や重複）
- `413` Payload Too Large（画像が5MBを超える）
- `415` Unsupported Media Type（閲覧数APIで `Content-Type` が `application/json` でない）
- `429` Too Many Requests（レート制限）
- `500` Internal Error

### 2.5 主な `error.code`
| code | ステータス | いつ |
|------|-----------|------|
| `UNAUTHORIZED` | 401 | ログインしていない |
| `INVALID_JSON` | 400 | 本文がJSONでない・オブジェクトでない |
| `VALIDATION_ERROR` | 400 | 必須項目の不足・形式違反・型違い |
| `FORBIDDEN` | 403 | 劇団の登録が無い・所属していない・オーナーだけの操作・承認済みでない劇団の公開・ほかの劇団の公演の宣伝文 |
| `NOT_FOUND` | 404 | 公演が見つからない |
| `SLUG_RESERVED` | 409 | 保存しようとしたURLが、ほかの公演の以前のURL（`event_redirects`） |
| `DB_ERROR` | 409 / 500 | 409 は公演のURL `(category, slug)` をほかの公演が使っている。500 はそれ以外の読み書きの失敗 |
| `THEATER_NAME_EXISTS` | 409 | 同じ名前の劇団がある |
| `LIMIT_REACHED` | 409 | 劇団に登録できるメール（所属＋保留中の招待）が2件に達している |
| `ALREADY_EXISTS` | 409 | 同じメールの招待がその劇団にもうある |
| `RATE_LIMITED` | 429 | レート制限（`Retry-After` ヘッダー付き） |
| `AI_ERROR` | 500 | AIの呼び出し・応答の読み取りに失敗 |

URLの重複は `code` が `DB_ERROR` でステータスが 409 になる。`code` だけでなくステータスも見て分ける。

### 2.6 レート制限
サーバーのメモリ上で数える（インスタンスごとに別。1分あたり）。

| API | 上限 | 数える単位 |
|-----|------|-----------|
| `POST /api/ai/analyze-flyer` | 10回 | ユーザー×IP |
| `POST /api/ai/generate-promotion` | 5回 | ユーザー×IP |
| `POST /api/storage/flyers` | 10回 | ユーザー×IP |
| `POST /api/views` | 60回 | IP×公演 |
| `POST /api/contact` | 5回 | IP |

---

## 3. 劇団の登録・所属

### 3.1 劇団登録

`POST /api/theater/onboard`

**権限**: 認証必須（authenticated）

**挙動**:
- 劇団（`theaters`）を **`status = approved`** で作成し、ログインユーザーを `theater_members(role=owner)` として紐づける（どちらも service_role で書く）
- 1つのアカウントで複数の劇団を登録できる（ほかの劇団に所属していても登録できる）
- 所属の追加に失敗したときは、作った劇団を消して 500 を返す

**Request body**:
```json
{
  "name": "劇団〇〇",
  "contact_email": "info@example.com",
  "website_url": "https://gekidan.example.com",
  "sns_x_url": "https://x.com/xxx",
  "sns_instagram_url": "https://instagram.com/xxx",
  "sns_facebook_url": "https://facebook.com/xxx",
  "description": "劇団紹介文",
  "logo_url": "https://{supabase-storage}/..."
}
```
- `name`・`contact_email` は必須（メールの形も確かめる）。ほかは任意の文字列

**Response（201）**:
```json
{
  "data": {
    "theater": {
      "id": "uuid",
      "status": "approved"
    }
  }
}
```

**エラー例**:
- `400` `VALIDATION_ERROR`（劇団名・連絡先メールが無い、メールの形が違う、項目が文字列でない）
- `401` `UNAUTHORIZED`
- `409` `THEATER_NAME_EXISTS`（同じ名前の劇団がすでにある。大文字小文字は区別しない）
- `500` `DB_ERROR`

### 3.2 自分の劇団の状態取得（招待の受諾を含む）

`GET /api/theater/me`

**権限**: 認証必須

**挙動**:
- ログイン中のメール（前後の空白を除き小文字にした値）と **完全一致** する保留中の招待（`theater_invites.status = pending`）を、古い順（`created_at` → `id`、最大10件）に見る
  - まだ所属していない劇団で、定員内（その劇団の所属＋保留中の招待が2以下）の最初の1件だけを受諾する（`theater_members` に `role = editor` で追加し、招待を `accepted` にする）
  - 1回の呼び出しで足す所属は1件まで。ほかの招待は保留のまま残す
- そのあと、選択中の劇団の情報・メンバー数・招待の一覧を返す

**Response（所属あり・例）**:
```json
{
  "data": {
    "theater": { "id": "uuid", "name": "劇団〇〇", "status": "approved" },
    "member": { "theater_id": "uuid", "role": "owner", "created_at": "2026-01-31T00:00:00Z" },
    "theaters": [{ "id": "uuid", "name": "劇団〇〇", "status": "approved", "role": "owner" }],
    "active_theater_id": "uuid",
    "stats": { "memberCount": 1, "inviteCount": 1, "totalAllowed": 2 },
    "invites": [{ "id": "uuid", "email": "member@example.com", "status": "pending", "created_at": "..." }],
    "joinedFromInvite": false,
    "pendingInvite": null
  }
}
```
- `member` には劇団の情報（`theater`）も入る
- 所属が無いときは `{ "data": { "theater": null, "member": null, "pendingInvite": ..., "theaters": [], "active_theater_id": null } }`

### 3.3 選択中の劇団

`GET /api/theater/active` / `PATCH /api/theater/active`

**権限**: 認証必須

- `GET`: `{ "data": { "active_theater_id": "uuid", "theaters": [...] } }`
- `PATCH`: Request `{ "theater_id": "uuid" }`。所属している劇団だけに切り替えられる。Response `{ "data": { "active_theater_id": "uuid" } }`

**エラー例**: `400` `VALIDATION_ERROR`（`theater_id` が無い）／`401`／`403` `FORBIDDEN`（その劇団に所属していない）

### 3.4 劇団情報

`GET /api/theater/profile` / `PATCH /api/theater/profile`

**権限**: 選択中の劇団の所属メンバー（`owner`・`editor` どちらも）

- `GET`: `{ "data": { "theater": { "id", "name", "description", "contact_email", "website_url", "status" }, "member": { "role": "owner" } } }`
- `PATCH`: Request `{ "name", "contact_email", "description", "website_url" }`（`name`・`contact_email` は必須）。Response `{ "data": { "theater": {...} } }`
  - 劇団名を変えると、その劇団の全公演の `company`（表示用の劇団名）も書き換える

**エラー例**: `400` `VALIDATION_ERROR`／`401`／`403` `FORBIDDEN`（劇団の登録が無い）／`500` `DB_ERROR`

### 3.5 招待（2人目のメール）

`POST /api/theater/invite` / `DELETE /api/theater/invite`

**権限**: 選択中の劇団の **`owner` だけ**

- `POST`: Request `{ "email": "member@example.com" }`
  - メールは前後の空白を除き小文字にして、`theater_invites` に `pending` で保存する
  - 定員: その劇団の所属＋保留中の招待が **2件以上なら** `409` `LIMIT_REACHED`
  - 同じ劇団に同じメールの招待がもうある（状態を問わない）と `409` `ALREADY_EXISTS`
  - Response（201）`{ "data": { "email": "member@example.com" } }`
  - 招待された人は、そのメールでログインして `GET /api/theater/me` を呼ぶと受諾される（3.2）
- `DELETE`: Request `{ "inviteId": "uuid" }`。選択中の劇団の招待だけを消す。Response `{ "data": { "deleted": true } }`

**エラー例**: `400` `VALIDATION_ERROR`／`401`／`403` `FORBIDDEN`（所属していない・`owner` でない）／`409`／`500` `DB_ERROR`

### 3.6 メンバー

`GET /api/theater/members` / `DELETE /api/theater/members`

**権限**: 選択中の劇団の **`owner` だけ**

- `GET`: `{ "data": { "members": [{ "user_id": "uuid", "role": "owner", "email": "..." }] } }`（メールは Supabase Auth の管理APIから引く）
- `DELETE`: Request `{ "userId": "uuid" }`。自分（`owner`）は消せない（403）。Response `{ "data": { "deleted": true } }`

**エラー例**: `400` `VALIDATION_ERROR`／`401`／`403` `FORBIDDEN`／`500` `DB_ERROR`

---

## 4. 劇団向け 公演CRUD（events）

> 公演の承認フローは無し。劇団のメンバーは、選択中の劇団の公演を作成・編集・非公開・完全削除できる。  
> ただし **`published` にできるのは theater.status=approved の劇団だけ**。  
> 公開・非公開・下書きへの切り替えは `PATCH /api/theater/events/{id}` の `status` で行う（専用の公開・非公開のAPIは無い）。

### 4.1 項目のきまり（作成・更新で共通）

| 項目 | きまり |
|------|--------|
| `category` | 主カテゴリ（必須）。`categories` 表の `id`。英数字・`_`・`-` の1〜64文字。**公演のURLはこれで決まる** |
| `categories` | 2つ目からのカテゴリ（任意・配列）。一覧の絞り込み・表示に使うタグで、URLを持たない。保存時は主カテゴリを先頭に入れた重複なしの配列になる。要素の形式は `category` と同じ |
| `slug` | 必須。前後の空白を除いたあと、英小文字・数字・ハイフンだけ、1〜80文字。先頭・末尾のハイフンとハイフンの連続は不可（`lib/event-slug.ts`）。`://`・`www.`・`/` を含む値（公式サイトのURLなど）は別の文で 400。大文字は小文字に直さず 400 |
| `price_general`・`price_student` | 円の整数（0以上・2147483647まで）か `null`。小数・負の数は 400「料金は円単位の整数（例：3000）で入力してください。」 |
| `status` | `draft`・`published`・`archived`。作成で省略すると `draft` |
| `schedule_times` | 公演日時の配列（`start_date`・`end_date`・`label`）。あると `start_date`・`end_date` はここから決まる（最も早い開始・最も遅い終了） |
| `venue_id` | 送らないと、`venue`（会場名）から会場マスタ（`venues`）を引いて自動で入れる（見つからなければ `null`） |
| そのほか | 文字列・数値・配列の項目の型が違うと 400（`VALIDATION_ERROR`） |

**URL `(category, slug)` の確認**（作成・更新で共通。見るのは主カテゴリの組だけで、`categories` の組は見ない）:
- ほかの公演が同じ `(category, slug)` を使っている → `409` `DB_ERROR`「このURL（英字）は、ほかの公演がすでに使っています。別の英字にしてください。」
- `(category, slug)` が `event_redirects` に、ほかの公演への転送として登録されている（ほかの公演の旧URL）→ `409` `SLUG_RESERVED`「このURLは、ほかの公演の以前のURLとして使われているため使えません。別の英字にしてください。」
  - 転送先が空の行（転送先の公演が削除済み）は数えない
  - 更新で、自分への転送（自分の旧URLに戻す）は使える

### 4.2 公演一覧

`GET /api/theater/events`

**権限**: 選択中の劇団の所属メンバー

**Response（例）**:
```json
{
  "data": {
    "events": [
      {
        "id": "uuid",
        "title": "夜明けのコーヒー",
        "slug": "nights-coffee",
        "category": "comedy",
        "categories": ["comedy", "drama"],
        "status": "draft",
        "start_date": "2026-02-01T19:00:00+09:00",
        "end_date": null,
        "updated_at": "...",
        "views_30": 0
      }
    ]
  }
}
```
- `views_30` は直近30日の閲覧数（`event_views_daily` の合計）

### 4.3 公演作成

`POST /api/theater/events`

**権限**: 認証必須（選択中の劇団に作る）

**Request body（例）**:
```json
{
  "category": "comedy",
  "categories": ["comedy", "drama"],
  "slug": "nights-coffee",
  "title": "夜明けのコーヒー",
  "description": "あらすじ...",
  "playwright": "山田太郎",
  "director": "山田太郎",
  "publish_at": null,
  "start_date": "2026-02-01T19:00:00+09:00",
  "end_date": null,
  "schedule_times": [{ "start_date": "2026-02-01T19:00:00+09:00", "end_date": null, "label": "" }],
  "reservation_start_at": null,
  "reservation_label": "劇団窓口",
  "reservation_links": [{ "label": "劇団窓口", "url": "https://ticket.example.com/..." }],
  "venue": "ぽんプラザホール",
  "venue_address": "福岡市...",
  "price_general": 2500,
  "price_student": 2000,
  "ticket_types": [{ "label": "一般", "price": 2500, "note": "" }],
  "tags": ["学生歓迎"],
  "image_url": null,
  "flyer_url": "https://{supabase-storage}/storage/v1/object/public/flyers-public/flyers/{...}.jpg",
  "analysis_flyer_url": null,
  "ticket_url": "https://ticket.example.com/...",
  "cast": [{ "name": "山田太郎", "role": "主人公", "image_url": "" }],
  "ai_confidence": null,
  "status": "draft"
}
```
- 必須は `category`・`slug`・`title`・公演の開始日（`schedule_times` の1件以上か `start_date`）
- `company`（表示用の劇団名）は劇団名が入る

**Response（201）**:
```json
{ "data": { "event": { "id": "uuid", "category": "comedy", "slug": "nights-coffee", "status": "draft" } } }
```

**エラー例**:
- `400` `VALIDATION_ERROR`（必須項目の不足、`slug`・`category`・料金・項目の型の形式違反）
- `401` `UNAUTHORIZED`
- `403` `FORBIDDEN`（劇団の登録が無い／`status = published` で劇団が `approved` でない）
- `409` `SLUG_RESERVED`／`409` `DB_ERROR`（URLの重複。4.1）
- `500` `DB_ERROR`

### 4.4 公演の取得

`GET /api/theater/events/{id}`

**権限**: 選択中の劇団の公演だけ  
**Response**: `{ "data": { "event": { ...全項目 } } }`。見つからなければ `404` `NOT_FOUND`

### 4.5 公演更新（公開・非公開の切り替えと、旧URLの登録を含む）

`PATCH /api/theater/events/{id}`

**権限**: 選択中の劇団の公演だけ（ほかの劇団の公演は 404）

**Request body**:
- 更新したい項目のみ（partial）。公開・非公開・下書きへの切り替えも `status` をここで送る（例: `{ "status": "archived" }`）
- `slug`: 送った値が今の値とまったく同じなら、形式の確認も更新もしない（以前の形式外の英字のままでも、ほかの項目を保存できる）。違う値のときだけ形式を確かめ、前後の空白を除いた結果が今の値と同じなら更新しない
- `category`・`categories`: どちらかを送ると、主カテゴリは `category`（無ければ `categories` の先頭、それも無ければ今の値）になる。`category` に空の文字は 400
- `superseded_by`（後継公演）: UUIDで、自分以外の、同じ劇団の公演だけ。`null` か `""` で外す

**挙動**:
- `status = published` は劇団が `approved` のときだけ（公開中の公演を `published` のまま保存する場合も同じ）。`status` を送らない保存・`draft`・`archived` への変更は、劇団の状態に関係なくできる
- 主カテゴリの組が変わるとき、または公開ページに出ていなかった公演がこの保存で出るようになるとき（下書きの公開など）は、保存後の組がほかの公演の旧URLでないかを確かめる（`409` `SLUG_RESERVED`）
- 主カテゴリの組が変わるときは、保存後の組をほかの公演が使っていないかを先に確かめる（`409` `DB_ERROR`。このときは何も書かない）
- 主カテゴリの組が変わり、保存前の公演が公開ページに出ていた（`published` で、`publish_at` が空か過去）ときは、**更新の前に**、保存前の組をこの公演への転送として `event_redirects` に登録する
  - ほかの公演への転送として登録済みの組は上書きしない（転送先が空の行だけ、この公演に向け直す）
  - `categories` の組は登録しない
  - 下書き・非公開・公開日前だった公演は登録しない（旧URLが外に出ていないため）
- 更新する項目が無いとき（今と同じ `slug` だけを送った、など）は、何も書かずに今の値を返す

**Response**:
```json
{ "data": { "event": { "id": "uuid", "category": "comedy", "slug": "nights-coffee", "status": "published" } } }
```

**エラー例**:
- `400` `VALIDATION_ERROR`
- `401` `UNAUTHORIZED`
- `403` `FORBIDDEN`（劇団の登録が無い／承認済みでない劇団の公開）
- `404` `NOT_FOUND`
- `409` `SLUG_RESERVED`／`409` `DB_ERROR`（URLの重複）
- `500` `DB_ERROR`

### 4.6 完全削除（DELETE）

`DELETE /api/theater/events/{id}`

**権限**: 選択中の劇団の公演だけ（ほかの公演の id では何も消えず、200 が返る）  
**Response**: `{ "data": { "ok": true } }`  
**注意**: `promotions`・`event_views_daily`・`event_view_marks` は外部キーで一緒に消える（ON DELETE CASCADE）。`event_redirects.to_event_id` は空になる（ON DELETE SET NULL）

### 4.7 画像のアップロード

`POST /api/storage/flyers`

**権限**: 認証必須  
**Request**: `multipart/form-data` の `file`（jpg・png・webp、5MB以下）  
**挙動**: Supabase Storage の `flyers-public` バケット（使えなければ `flyers`）の `flyers/{uuid}.{拡張子}` に保存する  
**Response**:
```json
{ "data": { "bucket": "flyers-public", "path": "flyers/{uuid}.jpg", "public_url": "https://..." } }
```
**エラー例**: `400` `INVALID_FORM`・`VALIDATION_ERROR`・`UNSUPPORTED_TYPE`／`401`／`413` `FILE_TOO_LARGE`／`429` `RATE_LIMITED`／`STORAGE_ERROR`（保存先の応答に合わせて 400・403・404・409・413・429・500）／`500` `STORAGE_FATAL`

---

## 5. AI機能

### 5.1 チラシ画像解析（Gemini）

`POST /api/ai/analyze-flyer`

**権限**: 認証必須  
**レート制限**: 10回/分（ユーザー×IP）

**Request body**:
```json
{
  "flyer_url": "https://{supabase-storage}/storage/v1/object/public/flyers-public/flyers/{...}.jpg",
  "page_url": null
}
```
- `flyer_url` か `page_url` のどちらかが必須
- `flyer_url` は `POST /api/storage/flyers` で保存した画像（`NEXT_PUBLIC_SUPABASE_URL` の Storage の `flyers-public`・`flyers` バケットの `flyers/` 以下）だけ。ほかのURLは `400` `FLYER_URL_NOT_ALLOWED`
- `page_url`（公式の公演ページ）からの読み取りは今は止めている。`flyer_url` と一緒なら画像だけで解析して `warnings` に書く。`page_url` だけなら `400` `PAGE_URL_DISABLED`

**モデル**: 環境変数 `GEMINI_ANALYZE_MODELS`（カンマ区切り）。無ければ `gemini-4-hydrogen`、失敗したら控えの `gemini-3.8-flash`

**Response（events字段へマッピング可能な形）**:
```json
{
  "data": {
    "result": {
      "title": "夜明けのコーヒー",
      "description": "あらすじ...",
      "image_url": null,
      "playwright": "山田太郎",
      "director": "山田太郎",
      "start_date": "2026-02-01T19:00:00+09:00",
      "end_date": "2026-02-03T21:00:00+09:00",
      "schedule_times": [{ "start_date": "2026-02-01T19:00:00+09:00", "end_date": null, "label": "" }],
      "reservation_links": [{ "label": "劇団窓口", "url": "https://..." }],
      "venue": "ぽんプラザホール",
      "venue_address": "福岡市...",
      "ticket_types": [{ "label": "一般", "price": 2500, "note": "" }],
      "price_general": 2500,
      "price_student": 2000,
      "category": "comedy",
      "tags": ["学生歓迎"],
      "cast": [{ "name": "山田太郎", "role": "主人公", "image_url": "" }],
      "ai_confidence": 0.86
    },
    "model": "gemini-4-hydrogen",
    "warnings": []
  }
}
```
- `category` は12カテゴリのどれか（当てはまらなければ `other`）

**エラー例**: `400` `VALIDATION_ERROR`・`FLYER_URL_NOT_ALLOWED`・`PAGE_URL_DISABLED`・`FLYER_FETCH_ERROR`・`PAGE_FETCH_ERROR`／`401`／`429` `RATE_LIMITED`／`500` `AI_ERROR`

### 5.2 SNS宣伝文生成（promotions作成）

`POST /api/ai/generate-promotion`

**権限**: 認証必須で、**公演の劇団の所属メンバーだけ**（選択中の劇団でなくてもよい）。ほかの劇団の公演は `403` `FORBIDDEN`「この公演の宣伝文は、公演の劇団のメンバーだけが作成できます。」（外部AIを呼ばず、`promotions` にも書かない）  
**レート制限**: 5回/分（ユーザー×IP）

**Request body**:
```json
{
  "event_id": "uuid",
  "platforms": ["twitter", "instagram", "facebook"]
}
```
- `platforms` は `twitter`・`instagram`・`facebook` から1つ以上。公演は保存済みであること（画面は保存前は呼ばない）

**挙動**: 公演を読む（ログイン中の利用者のクライアント。読めなければ 404）→ 所属を確かめる → Gemini（`gemini-3.0-flash`）で生成 → `promotions` に service_role で保存

**Response（例）**:
```json
{
  "data": {
    "promotions": [
      { "platform": "twitter", "text": "...", "hashtags": ["#福岡演劇"] },
      { "platform": "instagram", "text": "...", "hashtags": ["#演劇"] },
      { "platform": "facebook", "text": "...", "hashtags": ["#FUKUOKA_STAGE"] }
    ]
  }
}
```

**エラー例**: `400` `VALIDATION_ERROR`／`401`／`403` `FORBIDDEN`／`404` `NOT_FOUND`／`429` `RATE_LIMITED`／`500` `DB_ERROR`（所属の確認・保存の失敗）・`AI_ERROR`

---

## 6. PV計測（直近30日PV）

`POST /api/views`

**権限**: 未認証でも可（公演詳細ページの `ViewCounter` から呼ばれる）  
**Content-Type**: `application/json` だけ受ける（それ以外は `415` `UNSUPPORTED_MEDIA_TYPE`。ほかのサイトのフォームなどから訪問者のブラウザで加算させないため）  
**目的**: `event_views_daily`（日別）と `events.views`（累計）を、サーバーで重複を除いてから更新する

**Request body**:
```json
{
  "category": "comedy",
  "slug": "nights-coffee"
}
```

**挙動**:
1. `category`・`slug`・`status = published` で公演を引く。無い・公開日前なら `404`
2. 閲覧者の印（IP＋User-Agent＋日本時間の日付）と、IPの印（IP＋日付）を HMAC-SHA256 で作る。鍵は `VIEW_HASH_SECRET`、無ければ `SUPABASE_SERVICE_ROLE_KEY`。生の IP・User-Agent はDBに残さない
3. DB関数 `record_event_view` を service_role で1回呼ぶ。同じ閲覧者・公演・日は1回だけ、同じ IP・公演・日は5回まで数え、数えたときだけDBの中で日別・累計を +1 する（関数の中身は `docs/03_database.md`）

**Response（200）**:
```json
{ "data": { "ok": true, "counted": true } }
```
- 重複・上限で数えなかったときも 200（`counted: false`）。`ViewCounter` は応答が成功ならその日の cookie（`viewed_{category}_{slug}`）を付け、同じ日はもう呼ばない

**エラー例**: `400` `INVALID_JSON`・`VALIDATION_ERROR`／`404` `NOT_FOUND`／`415` `UNSUPPORTED_MEDIA_TYPE`／`429` `RATE_LIMITED`／`500` `CONFIG_ERROR`（`SUPABASE_SERVICE_ROLE_KEY` が無い）・`DB_ERROR`

**注意（実装ポリシー）**:
- IP は `x-real-ip`（Vercel が付ける値）、無ければ `x-forwarded-for` の先頭を使う
- 多数の端末・IPを使い回す相手までは防げない。防ぐのは「同じ閲覧者が同じ日に何度も数える」こと

---

## 7. お問い合わせ

`POST /api/contact`

**権限**: 不要  
**レート制限**: 5回/分（IP）

**Request body（例）**:
```json
{
  "name": "山田太郎",
  "email": "taro@example.com",
  "message": "問い合わせ内容",
  "recaptcha_token": "..."
}
```
- 4つとも必須。`message` は4000文字まで。`recaptcha_token` は `RECAPTCHA_SECRET_KEY` で確かめる

**挙動**: `contact_messages` に service_role で保存し、`RESEND_API_KEY`・`CONTACT_TO_EMAIL`・`CONTACT_FROM_EMAIL` がそろっていればメールで知らせる

**Response**:
```json
{ "data": { "ok": true, "contact_id": "uuid", "email_sent": true } }
```
- メールを送らなかった・送れなかったときも保存できていれば 200（`email_sent: false`）

---

## 8. 運営者

運営者向けAPIは `admins` テーブルに行がある人だけが使える（無ければ `403` `FORBIDDEN`）。

### 8.1 劇団の承認/停止

`PATCH /api/admin/theaters/{id}`

**権限**: 運営者のみ（`admins`）  
**Request body（例）**:
```json
{ "status": "suspended" }
```
- `status` は `pending`・`approved`・`rejected`・`suspended`
- ログイン中の利用者のクライアントで書く（RLS の `is_admin()` と、トリガー `trg_prevent_theater_status_update` を通る）
- 停止しても、その劇団のすでに公開中の公演は自動では非公開にならない（新しく公開できなくなるだけ）

**Response**: `{ "data": { "id": "uuid", "status": "suspended" } }`

### 8.2 そのほかの運営者向けAPI

| API | 内容 |
|-----|------|
| `PATCH /api/admin/events/{id}` | 下書きレビュー画面から `status` を `published`・`archived` にする。`published` は `draft` の公演で、`title`・`start_date`・`company` がそろっているときだけ。承認済みでない劇団の公演を `published` にするのは RLS で断られる（500） |
| `PATCH /api/admin/contact/{id}` | 問い合わせの `status` を `new`・`read`・`archived` にする |
| `GET`・`PATCH /api/admin/site-tags` | サイト全体に入れるタグ（`site_settings`）の読み書き（service_role） |

公開側の `GET /api/site-tags` は、`site_settings` のタグを返す（ログイン不要）。

---

**作成日**: 2026-01-31  
**最終更新日**: 2026-11-27  
**バージョン**: 1.1  
**作成者**: Claude Code (AI Assistant)

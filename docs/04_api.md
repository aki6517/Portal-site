# API設計書

## 1. 目的と前提

### 1.1 目的
- 劇団ダッシュボード（`/theater/`）からの **公演CRUD**、AI機能、PV計測、問い合わせ送信を安全に提供する
- RLS（DB権限）とアプリの状態遷移（劇団承認・公開状態）に整合したAPI境界を定義する

### 1.2 前提（要件との対応）
- 認証: Supabase Auth（Google OAuth + メールMagic Link）
- 劇団承認: `theaters.status` により公開可否を制御（未承認は `published` にできない）
- 公演URL: `/events/[category]/[slug]`
- 人気順: 直近30日PV（`event_views_daily` 集計）
- カテゴリ/slug変更時: 旧URL→新URLの301を作成（`event_redirects`）

### 1.3 APIの位置付け
- 公開ページは基本的にサーバーコンポーネント/DBアクセスで取得（SEO優先）
- **副作用がある処理**（AI、PV、リダイレクト作成、問い合わせ送信）はAPI経由

---

## 2. 共通仕様

### 2.1 ベースURL
- `https://{domain}/api/*`

### 2.2 認証
- 劇団ユーザー: Supabaseセッション（Cookie/Authorization）で認証
- 運営者: `admins` テーブルで判定（DB関数 `is_admin()`）
- **service_role**: サーバー内部処理（PV集計・リダイレクト書き込み等）で使用

### 2.3 レスポンス形式（JSON）
成功:
```json
{ "data": { "ok": true } }
```
失敗:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "slug is invalid"
  }
}
```

### 2.4 ステータスコード
- `200` OK
- `201` Created
- `400` Validation Error
- `401` Unauthorized
- `403` Forbidden（権限/RLS/承認待ちなど）
- `404` Not Found
- `409` Conflict（slug重複など）
- `429` Too Many Requests（AI/PV/フォームのレート制限）
- `500` Internal Error

---

## 3. 劇団オンボーディング

### 3.1 劇団プロフィール登録（初回/更新）

`POST /api/theater/onboard`

**権限**: 認証必須（authenticated）

**目的**:
- 劇団プロフィール（`theaters`）を作成し、ログインユーザーを `theater_members(role=owner)` として紐づける
- `theaters.status` は必ず `pending` で作成する（運営者が承認して `approved` にする）

**Request body（DB字段準拠）**:
```json
{
  "name": "劇団〇〇",
  "contact_email": "info@example.com",
  "website_url": "https://gekidan.example.com",
  "sns_x_url": "https://x.com/xxx",
  "sns_instagram_url": "https://instagram.com/xxx",
  "sns_facebook_url": "https://facebook.com/xxx",
  "description": "劇団紹介文",
  "logo_url": "https://{supabase-storage}/theaters/{...}.png"
}
```

**Response**:
```json
{
  "data": {
    "theater": {
      "id": "uuid",
      "status": "pending"
    }
  }
}
```

**エラー例**:
- `400` 必須項目不足
- `409` 既に別劇団に所属している（MVP制約）

### 3.2 自分の劇団状態取得

`GET /api/theater/me`

**権限**: 認証必須

**Response（例）**:
```json
{
  "data": {
    "theater": {
      "id": "uuid",
      "name": "劇団〇〇",
      "status": "approved"
    },
    "member": { "role": "owner" }
  }
}
```

---

## 4. 劇団向け 公演CRUD（events）

> 公演の承認フローは無し。劇団は自劇団の公演を作成・編集・非公開・完全削除できる。  
> ただし **`published` への変更は theater.status=approved の場合のみ許可**。

### 4.1 公演作成

`POST /api/theater/events`

**権限**: 認証必須（theater member）

**Request body（events字段）**:
```json
{
  "category": "comedy",
  "slug": "nights-coffee",
  "title": "夜明けのコーヒー",
  "description": "あらすじ...",
  "start_date": "2026-02-01T19:00:00+09:00",
  "end_date": "2026-02-03T21:00:00+09:00",
  "venue_id": null,
  "venue": "ぽんプラザホール",
  "venue_address": "福岡市...",
  "venue_lat": 33.59,
  "venue_lng": 130.39,
  "price_general": 2500,
  "price_student": 2000,
  "tags": ["学生歓迎", "笑い度98%"],
  "image_url": null,
  "flyer_url": "https://{supabase-storage}/events/{...}.jpg",
  "ticket_url": "https://ticket.example.com/...",
  "cast": [{ "name": "山田太郎", "role": "主人公", "image_url": "" }],
  "status": "draft"
}
```

**Response（例）**:
```json
{ "data": { "event": { "id": "uuid" } } }
```

**エラー例**:
- `409` `(category, slug)` 競合
- `400` `start_date` 不正 / `end_date < start_date` など

### 4.2 公演更新（301作成を含む）

`PATCH /api/theater/events/{id}`

**権限**: 認証必須（自劇団の公演のみ）

**要件**:
- `category` または `slug` が変わった場合、旧URL→新URLの `event_redirects` を作成する
- 公開中の公演でURLが変わる場合も同様（SEO維持）

**Request body**:
- 更新したい字段のみ（partial）

**Response**:
```json
{
  "data": {
    "event": { "id": "uuid" },
    "redirect_created": true
  }
}
```

### 4.3 公開（draft → published）

`POST /api/theater/events/{id}/publish`

**権限**: 認証必須

**挙動**:
- `theaters.status != 'approved'` の場合は `403`（公開不可）
- OKなら `events.status = 'published'`

### 4.4 非公開（archived）

`POST /api/theater/events/{id}/archive`

**権限**: 認証必須  
**挙動**: `events.status = 'archived'`

### 4.5 完全削除（DELETE）

`DELETE /api/theater/events/{id}`

**権限**: 認証必須  
**注意**: `promotions` 等はFKでCASCADE削除される前提

---

## 5. AI機能

### 5.1 チラシ画像解析（Gemini）

`POST /api/ai/analyze-flyer`

**権限**: 認証必須  
**レート制限**: 必須（例: IP/ユーザー単位で 10回/分 など）

**Request body**:
```json
{
  "flyer_url": "https://{supabase-storage}/events/{...}.jpg"
}
```

**Response（events字段へマッピング可能な形）**:
```json
{
  "data": {
    "result": {
      "title": "夜明けのコーヒー",
      "description": "あらすじ...",
      "start_date": "2026-02-01T19:00:00+09:00",
      "end_date": "2026-02-03T21:00:00+09:00",
      "venue": "ぽんプラザホール",
      "venue_address": "福岡市...",
      "price_general": 2500,
      "price_student": 2000,
      "category": "comedy",
      "tags": ["学生歓迎"],
      "cast": [{ "name": "山田太郎", "role": "主人公", "image_url": "" }],
      "ai_confidence": 0.86
    }
  }
}
```

### 5.2 SNS宣伝文生成（promotions作成）

`POST /api/ai/generate-promotion`

**権限**: 認証必須（自劇団の公演のみ）  
**Request body**:
```json
{
  "event_id": "uuid",
  "platforms": ["twitter", "instagram", "facebook"]
}
```

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

---

## 6. PV計測（直近30日PV）

`POST /api/views`

**権限**: 未認証でも可（公開ページから呼ばれる想定）  
**目的**: `event_views_daily` と `events.views` を更新する（改ざん防止のためサーバー側で集計）

**Request body**:
```json
{
  "category": "comedy",
  "slug": "nights-coffee"
}
```

**Response**:
```json
{ "data": { "ok": true, "contact_id": "uuid", "email_sent": true } }
```

**注意（実装ポリシー）**:
- 連打/ボット対策として、Cookie/UA/IP等での簡易デデュープ＋レート制限を行う
- DB直書きではなく service_role を用いた集計更新とする（RLSで制御）

---

## 7. お問い合わせ

`POST /api/contact`

**権限**: 不要  
**Request body（例）**:
```json
{
  "name": "山田太郎",
  "email": "taro@example.com",
  "message": "問い合わせ内容",
  "recaptcha_token": "..."
}
```

**Response**:
```json
{ "data": { "ok": true } }
```

---

## 8. 運営者（任意：UI化する場合）

### 8.1 劇団の承認/停止

`PATCH /api/admin/theaters/{id}`

**権限**: 運営者のみ（`admins`）  
**Request body（例）**:
```json
{ "status": "approved" }
```

---

**作成日**: 2026-01-31  
**最終更新日**: 2026-01-31  
**バージョン**: 1.0  
**作成者**: Claude Code (AI Assistant)

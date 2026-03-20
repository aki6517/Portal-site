# Portal Site（福岡アクトポータル）

## 記事公開ルール

### frontmatter 必須フィールド
すべてのブログ記事（`content/blog/*.md`）には以下のfrontmatterが必須：

```yaml
---
title: 記事タイトル
date: 2026-03-20T00:00:00.000Z
author: 西山明宏
author_role: 福岡アクトポータル編集運営
author_profile: 福岡の劇団「万能グローブ ガラパゴスダイナモス」（通称ガラパ）制作広報|自分の劇団作品が大好きでもっと知ってほしいと思い日々奮闘中
author_image: /authors/nishiyama-akihiro.jpg
category: 舞台
---
```

### オプションフィールド
- `description`: メタディスクリプション（120文字以内推奨）
- `author_bio`: 著者プロフィール補足
- `organization_name`: 運営組織名（例: 万能グローブガラパゴスダイナモス）
- `organization_url`: 組織URL（例: https://www.galapagos-dynamos.com/）
- `organization_logo`: 組織ロゴ（例: /icon.png?v=20260210a）

### デフォルト値（author系）
新規記事では以下をデフォルトで使用：
- `author`: 西山明宏
- `author_role`: 福岡アクトポータル編集運営
- `author_profile`: 福岡の劇団「万能グローブ ガラパゴスダイナモス」（通称ガラパ）制作広報|自分の劇団作品が大好きでもっと知ってほしいと思い日々奮闘中
- `author_image`: /authors/nishiyama-akihiro.jpg
- `category`: 舞台

### ファイル名規則
- 英語スラッグ、ハイフン区切り（例: `butai-hajimete-miniiku.md`）
- 日本語タイトルはローマ字に変換して使用

### コンテンツルール
- `author_profile` は `|` 区切りで2項目以上
- `author_image` は `/authors/` で始まるパス
- リンクはMarkdown記法を使用（裸URLはバリデーションエラー）
- 表は2行以上、2行目は `| --- |` 区切り行が必須
- 「福岡の劇団「万能グローブ ガラパゴスダイナモス」（通称ガラパ）」はリンク化する
- **「」と太字（`**`）の併用禁止**: `**「テキスト」**` は使わない。「」だけで十分な強調になる。バリデーションでエラーになる

### 公開手順
1. `node scripts/validate-content.mjs` でバリデーション
2. 記事ファイルのみ `git add`
3. `git commit` で記事タイトルを含むメッセージ
4. `git push origin main` でVercel自動デプロイ

### カテゴリ例
- 舞台
- お知らせ
- コラム

## 技術スタック
- Next.js 16 + React 19
- TinaCMS 3.3.2（簡単な修正用）
- Tailwind CSS v4
- Vercel デプロイ（main ブランチ push で自動）
- markdown-it でHTML変換（表・リンク・FAQ抽出対応済み）

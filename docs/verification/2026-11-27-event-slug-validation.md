# 公演登録フォームのスラッグ欄に URL が入るのを防ぐ（実装指示書）

作成: 2026-11-27 せお／実装: Claude Code Opus 5.5 xhigh／独立レビュー: Codex gpt-6.2-sol xhigh

```xml
<task>
【何をするか】
劇団が公演を登録・編集するフォームの「URL用英字名（スラッグ）」欄に、公式サイトの URL（例 `https://www.michinox.com/`）が入力され、そのまま公開 URL（/events/{category}/{slug}）とサイトマップに使われていた。2026-11 時点で 5 件起きた（データは 11/27 にせおが英字へ付け替え済み・旧 URL は event_redirects で転送済み）。
同じことが二度と起きないように、次の 3 か所でスラッグの形式を検査する。

1. 共通の検査関数を 1 つ作る（新規ファイル `lib/event-slug.ts`）
   - 許可する形：前後の空白を除いたあと、英小文字・数字・ハイフンだけ。先頭と末尾はハイフン不可、ハイフンの連続不可。長さ 1〜80 文字
     正規表現の目安: `^[a-z0-9]+(?:-[a-z0-9]+)*$`
   - 戻り値で「どんな理由でダメか」を区別できるようにする（少なくとも「URL っぽい（`://` や `www.` や `/` を含む）」と「それ以外の形式違反」と「長すぎる」）
   - 大文字は自動で小文字にしない（入力欄の表示と保存値がずれるため）。大文字は形式違反として扱い、メッセージで小文字を案内する
   - クライアント（EventForm）とサーバー（API）の両方から import できる純粋関数にする（Node 専用 API や React に依存しない）

2. 公演フォーム `app/theater/events/_components/EventForm.tsx`
   - スラッグ欄のラベル・説明文・placeholder を下の【画面の文言】のとおりに変える
   - 入力中に形式違反ならエラー文を欄の下に出す（赤系の既存スタイルがあればそれに合わせる。無ければ text-xs の既存の注意書きと同じ大きさで、色だけ変える）
   - `submit()` の既存の必須チェック（`!form.slug.trim()` の箇所）のすぐ後で形式も検査し、違反なら送信せず既存の `setMessage(...)` でエラー文を出す
   - **編集時の例外**：既存の公演を編集していて、スラッグが「読み込んだときの値」から変わっていない場合は、形式違反でも送信を止めない（過去の公演に `百年桃` や `mime_faust` のような形式外のスラッグが残っており、それらの劇団がほかの項目を編集できなくなるのを防ぐため）。このときは欄の下に「このままでも保存できます」と分かる控えめな注意だけ出す
   - 「公開URL: /events/{primaryCategory}/{slug}」のプレビュー表示は残す

3. API
   - `app/api/theater/events/route.ts`（POST・新規作成）：既存の必須チェックのあとで形式を検査し、違反なら 400 を返す。レスポンスの形は既存の 400 と同じ形（`{ error: { message } }` 等、ファイル内の既存パターンに合わせる）。メッセージは日本語（【画面の文言】のエラー文と同じ）
   - `app/api/theater/events/[id]/route.ts`（PATCH・更新）：`payload.slug` が送られてきて、かつ**現在の slug と違う値**のときだけ形式を検査し、違反なら 400。現在値と同じなら検査しない（上の編集時の例外と同じ理由）。検査は `current` を読み込んだあとの位置で行う

【画面の文言】（この文言をそのまま使う。言い回しを変えない）
- ラベル: `公演ページのURLに使う英字（必須）`
- placeholder: `kemonohito`
- 説明文（欄の下・常に表示）: `福岡アクトポータルでの公演ページのURLになります。英小文字・数字・ハイフン（-）で入力してください。例：kemonohito → /events/drama/kemonohito`
- 説明文の2行目（常に表示）: `劇団の公式サイトや予約ページのURLは、ここではなく下の「販売所・予約窓口」の欄に入れてください。`
- エラー（URL っぽい入力）: `ここには公式サイトなどのURLは入れられません。公演名などを英小文字・数字・ハイフンで入れてください（例：kemonohito）。`
- エラー（それ以外の形式違反）: `英小文字（a〜z）・数字・ハイフン（-）だけで入力してください。ハイフンは先頭・末尾・連続では使えません。`
- エラー（長すぎる）: `80文字以内で入力してください。`
- 編集時に既存の形式外スラッグのまま: `今のURLのまま保存できます。変える場合は英小文字・数字・ハイフンで入力してください。`
- submit 時の既存メッセージ「URL用英字名と公演タイトルは必須です。」は「公演ページのURLに使う英字と公演タイトルは必須です。」に変える

【対象ファイル】
- lib/event-slug.ts（新規）
- app/theater/events/_components/EventForm.tsx
- app/api/theater/events/route.ts
- app/api/theater/events/[id]/route.ts

【読む範囲】
- 読んでよい: 上の 4 ファイル、`CLAUDE.md`、`lib/` の中で上の 3 ファイルが import しているもの、`app/events/[category]/[slug]/page.tsx`（slug と event_redirects の使われ方を確かめる場合だけ）
- 読まなくていい: node_modules・.next・content/・public/・scripts/harvest・supabase/migrations（DB は変えない）

【完了条件】
- 上の 1〜3 がすべて入っていること
- `npx tsc --noEmit` がエラー 0（既存のエラーが元からある場合は、変更前と変更後の件数を比べて増えていないこと）
- `npx eslint lib/event-slug.ts app/theater/events/_components/EventForm.tsx app/api/theater/events/route.ts "app/api/theater/events/[id]/route.ts"` で新しいエラーが出ないこと
- 検査関数の動作確認を `node --experimental-strip-types` などで実際に走らせ、結果を報告に貼ること。最低限この入力で確認する:
  `kemonohito`（OK）／`hiroshigun-kibiru2027`（OK）／`hv-fpap-202612-154fb5`（OK）／` kemonohito `（前後空白→OK扱い）／`https://www.michinox.com/`（URL）／`www.example.com`（URL）／`x.com/san_fura2015`（URL）／`Kemonohito`（形式違反）／`-abc`・`abc-`・`a--b`（形式違反）／`mime_faust`（形式違反）／`百年桃`（形式違反）／空文字（形式違反または必須エラー）／81文字（長すぎる）

【背景】
- スラッグは公開 URL `/events/{category}/{slug}` とサイトマップにそのまま使われる。URL がまるごと入ると `/events/drama/https%3A%2F%2Fwww.michinox.com%2F` のような URL になる
- 劇団は「URL用英字名」の「URL」を見て、公式サイトの URL を入れたと思われる（5 件とも公式サイトや X の URL だった）
- 編集 API（PATCH）は slug かカテゴリが変わると `event_redirects` に旧 URL を登録する既存の仕組みがある。これは変えない
- 自動収集（harvest）は `hv-` で始まる形式のスラッグを自分で作るので、今回の検査の対象外（触らない）
</task>

<completeness_contract>
Resolve the task fully before stopping.
Do not stop at the first plausible answer.
Check whether there are follow-on fixes, edge cases, or cleanup needed for a correct result.
</completeness_contract>

<verification_loop>
Before finalizing, verify the result against the task requirements and the changed files or tool outputs.
If a check fails, revise the answer instead of reporting the first draft.

【このタスクの検証コマンド】
npx tsc --noEmit
npx eslint lib/event-slug.ts app/theater/events/_components/EventForm.tsx app/api/theater/events/route.ts "app/api/theater/events/[id]/route.ts"
（検査関数の動作確認スクリプトは scratchpad など、リポジトリの外に置いて走らせる。リポジトリにテストファイルは足さない）
</verification_loop>

<action_safety>
Keep changes tightly scoped to the stated task.
Avoid unrelated refactors, renames, or cleanup unless they are required for correctness.
Call out any risky or irreversible action before taking it.
子エージェント（Claude の Agent ツール）を使わず自分で実装する。レビューは外から別途回す。

【このタスクで触ってはいけないもの】
- DB・Supabase（マイグレーションも SQL も実行しない）
- git commit / push / branch 操作（変更はワーキングツリーに置いたままにする）
- `npm run build`・`npm run dev`（Tina の環境変数が要るので走らせない）
- 上の 4 ファイル以外の変更（必要だと判断したら、変えずに報告に書く）
- 推測で実装しない。Next.js 16 / React 19 の挙動で不確かな点は、リポジトリ内の既存コードの書き方に合わせる
- 言いなりに直さない。この指示書に矛盾や穴があれば、実装する前に自分で確かめ、根拠をつけて報告に書く
- 保証できないことを保証するふりをしない
</action_safety>

<structured_output_contract>
報告は次の 4 項目だけ:
1. 変更したファイル（`git status --short --untracked-files=all` の出力をそのまま）
2. 何をどう変えたか（ファイルごとに 2〜4 行）
3. 検証の結果（実行したコマンドと出力の要点。動作確認スクリプトの入力と結果の表）
4. 未解決・気になる点（指示書との食い違い、判断に迷ったところ）
</structured_output_contract>
```

## C-3 で変えたこと（2026-11-27・Codex 1周目の指摘を受けて）

- 説明文 2 行目は「劇団の公式サイトや予約ページのURLは、ここではなく「販売所・予約窓口」の欄に入れてください。」に変更（新規作成ウィザードでは「販売所・予約窓口」が別ステップにあり、「下の」が指す先が見えないため）
- 「スラッグが変わっていないか」は trim 前の生の値で比べる。フォームは変わっていなければ送信データから slug キーを外す。PATCH は送られた slug が current.slug と完全一致、または trim 後に一致なら update に slug を入れない（同時編集で他人が直した値を古い値で上書きしない）
- PATCH は slug キーがあって文字列でなければ 400。"" や " " を current と違う値として送ったら 400
- POST・PATCH とも、slug が文字列でない値のとき trim() の例外ではなく 400（VALIDATION_ERROR）を返す。POST の必須エラー（キーなし・null・空・空白のみ）は従来どおり
- 新規作成ウィザードで最終送信がスラッグの形式違反で止まったら、ステップ「基本」に戻してスラッグ欄にフォーカス
- 公開URLのプレビューは trim 後の値。作成後の編集パスは POST の応答（保存済みのカテゴリ・スラッグ）を優先
- 範囲外として残したもの: event_redirects の upsert と公演更新のトランザクション化、楽観ロック（409）、DB のトリガー・制約、docs/04_api.md と実装の食い違い

## C-3 2周目で変えたこと（Codex 2周目の指摘を受けて）

- PATCH で更新項目が空（同じ slug だけを送った等）のとき、DB 更新・event_redirects 登録・revalidateTag を省き、current の値で 200 を返す（直す前は空の update が PGRST116 になり 500 だった）
- 新規作成ウィザードで、スラッグ由来の画面下メッセージは、スラッグが有効な値・空・読み込み値に戻ったら消す（ほかの理由のメッセージは消さない）
- 範囲外として残したもの（Codex 2周目）: 保存済みスラッグが空の公演の編集（本番0件）、別カテゴリに同じスラッグがあるときの転送先のずれ、スラッグ付き編集URLを再読み込みしたとき、保存直後の再保存の競合、JSON の null 本文

## 判定（C-4・せお）

needs-attention → 西山くんのGO待ち。tsc 0件・eslint 0件・検査関数24ケース・ルートの模擬呼び出し（PATCH 20＋POST 13ケース）・フォームの静的描画を、せおが自分で再実行して確認。ブラウザでのウィザード操作（戻ってフォーカス・メッセージが消える）は未確認

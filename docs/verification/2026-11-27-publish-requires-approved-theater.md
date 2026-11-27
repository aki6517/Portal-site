# 承認済みでない劇団は公演を公開できないようにする（実装指示書）

作成: 2026-11-27 せお／実装: Claude Code Opus 5.5 xhigh／独立レビュー: Codex gpt-6.2-sol xhigh

```xml
<task>
【何をするか】
API 仕様書 `docs/04_api.md` の「4. 劇団向け 公演CRUD」には「`published` への変更は theater.status=approved の場合のみ許可」とあるが、実装（POST `app/api/theater/events/route.ts`・PATCH `app/api/theater/events/[id]/route.ts`）は劇団の status を見ずに `published` を保存している。
管理画面（app/admin/theaters）で劇団を「停止中（suspended）」「却下（rejected）」「審査中（pending）」にしても、その劇団のメンバーは公演を公開できてしまう。仕様書どおり、承認済み（approved）でない劇団は公演を `published` にできないようにする。

1. POST（新規作成）: 保存する status が `published` で、劇団の status が `approved` でなければ 403 を返して保存しない。`draft`（既定値）や `archived` での作成は今までどおり許可する
2. PATCH（更新）: 送られた status が `published` で、劇団の status が `approved` でなければ 403 を返して保存しない。status を送らない編集・`draft`/`archived` への変更は今までどおり許可する（停止中の劇団でも、公開をやめる操作や下書きの編集はできるようにするため）
3. 403 の形は、各ファイルの既存の 403 の形に合わせる（`{ error: { code, message } }`）。code は既存に `FORBIDDEN` のような 403 用の code があればそれ、無ければ `THEATER_NOT_APPROVED`。message は次の文言そのまま：
   `劇団の登録が承認済みではないため、公演を公開できません。下書きとして保存するか、福岡アクトポータル運営にお問い合わせください。`
4. 劇団の status は、そのリクエストで実際に保存先になる劇団（POST は insert する theater_id の劇団、PATCH は対象公演が属する劇団＝既存コードが権限確認に使っている劇団）のものを使う。どの劇団の status を見ているかを報告に書く
5. 画面（EventForm）は、API の 403 のメッセージを既存のエラー表示でそのまま出せるかを確かめる。出せるなら画面のコードは変えない。出せない（メッセージが握りつぶされる）場合だけ、最小の変更で出せるようにする

【対象ファイル】
- app/api/theater/events/route.ts
- app/api/theater/events/[id]/route.ts
- （5 で必要な場合だけ）app/theater/events/_components/EventForm.tsx

【読む範囲】
- 読んでよい: 上のファイル、lib/theater/activeTheater.ts、docs/04_api.md の「4.」の節、app/admin/theaters の status の値（pending/approved/rejected/suspended）を確かめる範囲、CLAUDE.md
- 読まなくていい: node_modules・.next・content/・public/・scripts/・supabase/migrations

【完了条件】
- 1〜4 が入っていること（5 は確かめた結果を報告）
- `npx tsc --noEmit --incremental false` がエラー 0 件
- `npx eslint app/api/theater/events/route.ts "app/api/theater/events/[id]/route.ts"`（EventForm を変えたらそれも）で新しいエラーが出ないこと
- 既存のハーネス `/private/tmp/claude-501/-Users-nishiyamaakihiro/fe82cbc3-8585-4c48-af0b-a1999dd2dd91/scratchpad/slug-guard-check/route-harness/`（Supabase を模擬してルートを呼ぶ。`node --experimental-strip-types --import ./register.mjs run.mjs` で動く）を流用して、劇団の status（approved / pending / rejected / suspended）× 送る status（なし / draft / published / archived）の POST と PATCH を実際に呼び、表で報告する。前回のスラッグ検査のケースも引き続き通ること

【背景】
- 劇団の登録（app/api/theater/onboard）は作成時に status=approved にしている（即承認）。2026-11-27 時点で本番の劇団 97 件はすべて approved なので、この修正で今の劇団が公開できなくなることはない
- 管理者が劇団を停止したときに、その劇団が新しく公開できないようにするのが目的
- すでに公開中の公演を、劇団の停止に合わせて非公開にする処理や、公開ページ側で停止中の劇団の公演を隠す処理は、今回の範囲外（触らない）
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
npx tsc --noEmit --incremental false
npx eslint app/api/theater/events/route.ts "app/api/theater/events/[id]/route.ts"
（ハーネスはリポジトリの外。リポジトリにテストファイルは足さない）
</verification_loop>

<action_safety>
Keep changes tightly scoped to the stated task.
Avoid unrelated refactors, renames, or cleanup unless they are required for correctness.
Call out any risky or irreversible action before taking it.
子エージェント（Claude の Agent ツール）を使わず自分で実装する。レビューは外から別途回す。

【このタスクで触ってはいけないもの】
- DB・Supabase（マイグレーションも SQL も実行しない）
- git commit / push / branch 操作（変更はワーキングツリーに置いたままにする）
- `npm run build`・`npm run dev`
- 対象ファイル以外の変更（必要だと判断したら、変えずに報告に書く）
- 前回入れたスラッグ検査（lib/event-slug.ts と、ルート・フォームの検査部分）の挙動を変えない
- 言いなりに直さない。この指示書に矛盾や穴があれば、実装する前に自分で確かめ、根拠をつけて報告に書く
- 保証できないことを保証するふりをしない
</action_safety>

<structured_output_contract>
報告は次の 4 項目だけ:
1. 変更したファイル（`git status --short --untracked-files=all` の出力をそのまま）
2. 何をどう変えたか（ファイルごとに 2〜4 行。どの劇団の status を見ているか）
3. 検証の結果（実行したコマンドと出力の要点。ハーネスの表）
4. 未解決・気になる点（指示書との食い違い、判断に迷ったところ）
</structured_output_contract>
```

## 判定（C-4・せお・2026-11-27）

ship（西山くん「レビュー終わったら本番に出して」）。Codex gpt-6.2-sol xhigh 1周：今回の変更に High/Medium の不具合なし。指摘はすべて既存の穴か範囲外として記録のみ：
- High（既存）: 初期SQLの theater_members の INSERT ポリシーが本番で有効なら、他劇団の所属を自己登録できる → 本番の RLS を確認して別件で対処
- Medium（範囲外）: 承認状態の読み取りと保存の間に停止された場合の競合／停止中の劇団は公開中の公演を published のまま保存できない（安全側の仕様として採用）
- Low（既存）: 公演取得失敗が404になる・不正な status が500・EditEventScreen のエラー表示位置・docs/04_api.md の /publish /archive がコードにない・設計書は RLS で守ると書くが実装は service_role＋ルート内判定

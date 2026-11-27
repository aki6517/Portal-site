# セキュリティ修正 1便目：招待のメール照合・AI宣伝文の権限・招待のRLS（実装指示書）

作成: 2026-11-27 せお／実装: Claude Code Opus 5.5 xhigh／独立レビュー: Codex gpt-6.2-sol xhigh／本番適用: せお（西山くん「上から順に改善する」）

```xml
<task>
【何をするか】
2026-11-27 の Codex レビューで見つかった、もとからある 3 つの穴を直す。

1. 【High】招待の受諾でメールアドレスを `ilike` で照合している（app/api/theater/me/route.ts 26〜33行付近）
   - `.ilike("email", user.email)` は `_`（任意の1文字）と `%`（任意の文字列）をワイルドカードとして扱う。たとえば `a_b@example.com` 宛ての保留中の招待に、`axb@example.com` でログインした別人が一致し、その劇団の editor になれる
   - 直し方: ログイン中のメールを `trim().toLowerCase()` で正規化し、`.eq("email", 正規化した値)` で完全一致にする。招待は作成時（app/api/theater/invite/route.ts 25行）にすでに `trim().toLowerCase()` で保存されている（本番の招待 3 件もすべて正規化済みを確認済み）
   - 同じメール宛ての保留中の招待が複数の劇団にあると、今の `.maybeSingle()` はエラーで null になり、正規の招待も受諾されない。作成の古い順（created_at 昇順）に並べて 1 件だけを対象にする（`.order(...).limit(1)` など）。ほかの招待は保留のまま残す
   - user.email が無い・空のときは今までどおり何もしない
   - 受諾の流れ（所属の追加 → 招待を accepted に更新）とその条件（定員 total <= 2 など）は変えない
2. 【Medium】AI 宣伝文の生成 `app/api/ai/generate-promotion/route.ts` が、ログインしているだけで他劇団の公開公演に対して生成でき、service_role で `promotions` に行を保存する
   - 対象公演の取得はログイン中の利用者のクライアント（RLS で公開公演は誰でも読める）で行っているため、所属を確かめていない
   - 直し方: 公演を取得したあと、生成（外部 AI の呼び出し）より前に、ログイン中の利用者がその公演の劇団（event.theater_id）の所属メンバーかを確かめ、違えば 403 `{ error: { code: "FORBIDDEN", message: "この公演の宣伝文は、公演の劇団のメンバーだけが作成できます。" } }` を返す。所属の確認は `lib/theater/activeTheater.ts` の resolveActiveTheater の memberships（アクティブな劇団だけでなく、所属しているすべての劇団）を使う
   - 生成 API を呼んでいる画面（劇団の公演編集など）を確かめ、正規の利用（自劇団の公演）が 403 にならないことを確認する。運営者用の画面から呼んでいる箇所があれば、変えずに報告する
3. 【Medium】`theater_invites` の RLS ポリシー「Theater members can manage invites」（FOR ALL TO authenticated、USING/WITH CHECK `is_theater_member(theater_id) OR is_admin()`）で、editor でもブラウザから直接招待を作成・変更・削除でき、API の「owner だけ」「定員」の確認をすり抜けられる
   - アプリの theater_invites への読み書きは、すべて service_role（createSupabaseServiceClient）で行っているはず（app/api/theater/invite・me）。これを grep と目視で確かめ、ログイン中の利用者のクライアントで theater_invites を読み書きしている箇所が無いことを表で報告する
   - 無ければ、マイグレーション `supabase/migrations/20261127130019_theater_invites_admin_only.sql`（docs/sql/019_theater_invites_admin_only.sql に同じ中身の写し）で、このポリシーを消し、運営者だけの FOR ALL ポリシー「Admins can manage invites」（USING/WITH CHECK `is_admin()`）に置き換える。同名ポリシーの `DROP POLICY IF EXISTS` を先に入れて再実行できるようにする。先頭のコメントに理由を 2〜3 行
   - ログイン中の利用者のクライアントで使っている箇所が見つかった場合は、マイグレーションを書かずに報告する

【対象ファイル】
- app/api/theater/me/route.ts
- app/api/ai/generate-promotion/route.ts
- supabase/migrations/20261127130019_theater_invites_admin_only.sql（新規）
- docs/sql/019_theater_invites_admin_only.sql（新規・上と同じ中身）

【読む範囲】
- 読んでよい: CLAUDE.md、上の対象ファイル、app/api/theater/invite/route.ts、lib/theater/activeTheater.ts、lib/supabase/、生成 API を呼ぶ画面（grep で探す）、supabase/migrations/・docs/sql/（ポリシー名の確認）
- 読まなくていい: node_modules・.next・content/・public/

【完了条件】
- 1〜3 が入っていること（3 は確認の結果しだい）
- `npx tsc --noEmit --incremental false` がエラー 0 件
- `npx eslint app/api/theater/me/route.ts app/api/ai/generate-promotion/route.ts` で新しいエラーが出ないこと
- 1 と 2 は、Supabase を模擬してルートのハンドラーを実際に呼んで確かめる（既存のハーネス /private/tmp/claude-501/-Users-nishiyamaakihiro/fe82cbc3-8585-4c48-af0b-a1999dd2dd91/scratchpad/slug-guard-check/route-harness/ の仕組みを流用してよい。新しく作るものも scratchpad に置く）。最低限：
  - 1: 招待 `a_b@example.com` に `axb@example.com` でログイン → 受諾されない／`A_B@Example.com` でログイン（大文字）→ 受諾される／同じメール宛ての保留中の招待が 2 劇団 → 古いほうだけ受諾される／メールなし → 何もしない
  - 2: 他劇団の公開公演 → 403 で外部 AI を呼ばない・promotions に書かない／自劇団の公演 → 今までどおり進む（外部 AI は模擬でよい）／アクティブではない別の所属劇団の公演 → 進む
- マイグレーションの SQL は、Postgres が無いので目と構文解析（前回 scratchpad に入れた libpg-query があれば使ってよい）で確かめる

【背景】
- 2026-11-27 に theater_members の自己 owner 登録と theaters の直接作成の RLS はふさいだ（migration 20261127120018）。今回はその続き
- 本番の招待は 3 件（pending 1・accepted 2）、メールはすべて小文字・空白なし
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
npx eslint app/api/theater/me/route.ts app/api/ai/generate-promotion/route.ts
（ハーネスはリポジトリの外。リポジトリにテストファイルは足さない）
</verification_loop>

<action_safety>
Keep changes tightly scoped to the stated task.
Avoid unrelated refactors, renames, or cleanup unless they are required for correctness.
Call out any risky or irreversible action before taking it.
子エージェント（Claude の Agent ツール）を使わず自分で実装する。レビューは外から別途回す。

【このタスクで触ってはいけないもの】
- DB・Supabase への接続（db push・link・SQL の実行はしない。本番への適用はせおがやる）
- git commit / push / branch 操作
- `npm run build`・`npm run dev`
- 対象ファイル以外の変更（必要だと判断したら、変えずに報告）
- 言いなりに直さない。この指示書に矛盾や穴があれば、根拠をつけて報告に書く
- 保証できないことを保証するふりをしない
</action_safety>

<structured_output_contract>
報告は次の 4 項目だけ:
1. 変更したファイル（`git status --short --untracked-files=all` の出力をそのまま）
2. 何をどう変えたか（ファイルごとに 2〜4 行。マイグレーションは全文）
3. 検証の結果（コマンドと出力の要点、ハーネスの表、theater_invites の使用箇所の表）
4. 未解決・気になる点
</structured_output_contract>
```

## 判定と適用（C-4・せお・2026-11-27）

ship（西山くん「上から順に改善する」）。Codex gpt-6.2-sol xhigh 2周＋実装担当の自己レビュー。High なし。

- 1周目で直したもの：最古の招待が所属済み・定員超過だと後の招待が詰まる／count エラーが 0 扱い／同時刻の順序（id で決める）／generate-promotion が resolveActiveTheater 経由で user_settings に書き込む・取得エラーが 403
- 2周目で直したもの：count が error なしで null・NaN のとき定員チェックをすり抜ける／service クライアント生成の例外で JSON が返らない
- 記録だけ（直さない）：同じメールに受諾できない招待が10件以上あると11件目を見ない（本番の招待は3件）／招待の受諾・作成の同時実行のずれ・トランザクション化／生成中に所属を外されたときの保存／/register の「有効化しています」が出たままになる場合／JSON が null のときの 500／Gemini 例外の文言がそのまま返る／ドキュメントの古い記述（docs/02・03・04）
- 指示書の誤り：ilike の悪用例の向きが逆（ワイルドカードが効くのはログイン側のメール）。ハーネスは正しい向き（1-2〜1-4）で再現・解消を確認
- 本番 DB：`supabase db push --linked` で 20261127130019 を適用（dry-run で対象1本を確認）。適用後の theater_invites のポリシーは "Admins can manage invites"（ALL・is_admin()）の1本だけ。RLS は有効
- 本番の招待3件（accepted 2・pending 1）は、どれも劇団のオーナーか運営が作ったもので、不審な行はなし
- ハーネス：scratchpad/security-batch-a/harness（31件 ALL OK）。前回までのハーネス（スラッグ検査・承認済み劇団の公開制限）も通過

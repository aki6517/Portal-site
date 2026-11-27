# セキュリティ修正 2便目：旧URLの転送先がずれる・ほかの公演の旧URLを奪える件（実装指示書）

作成: 2026-11-27 せお／実装: Claude Code Opus 5.5 xhigh／独立レビュー: Codex gpt-6.2-sol xhigh／本番適用: せお（西山くん「上から順に改善する」）

```xml
<task>
【何をするか】
公演のURLは `/events/{category}/{slug}`。スラッグやカテゴリを変えると、PATCH（app/api/theater/events/[id]/route.ts）が `event_redirects`（from_category, from_slug → to_event_id。(from_category, from_slug) に一意制約）に旧URLを登録し、公開ページ（app/events/[category]/[slug]/page.tsx）は公演が見つからないときにこの表を見て 308 で転送する。
events の一意制約は (category, slug) だけで、同じスラッグを別カテゴリで使える。ここに次の 3 つの穴がある。

1. 【公開ページの解決順】page.tsx は `getEventBySlug(category, slug)`（lib/data/events.ts の pickMatchedEvent。スラッグだけで検索し、カテゴリが一致する公演、無ければ一致しない最初の公演を選ぶ）を先に呼び、見つかればカテゴリ違いでもその公演へ転送する。そのため `drama/old` を `drama/new` に変えて `drama/old → drama/new` の転送を登録しても、別の公演 `comedy/old` が公開中なら、`drama/old` は `comedy/old` へ転送されてしまう
   - 直し方: カテゴリ（category か categories）が一致する公演が見つからないときは、カテゴリ違いの候補へ転送する前に `event_redirects` の (category, slug) を確かめ、あればそちらへ転送する。カテゴリが一致する公演があるときの動き、どちらも無いときの 404、カテゴリ違いの候補しか無く転送も無いときの「その候補へ転送」は今までどおり
2. 【ほかの公演の旧URLを奪える】劇団が公演を作成（POST）・更新（PATCH）するときに、(category, slug) が `event_redirects` に「別の公演への転送」として登録されていても、そのURLを使えてしまう。使うと 1 の解決順で新しい公演が優先され、ほかの公演の旧URL（検索結果やSNSに残っているリンク）を奪える
   - 直し方: POST と PATCH（スラッグかカテゴリが変わるとき）で、保存しようとしている (category, slug) が `event_redirects` にあり、その to_event_id が自分（PATCH の対象公演）でなければ 409 を返して保存しない。形は既存の 409 の形に合わせ、message は `このURLは、ほかの公演の以前のURLとして使われているため使えません。別の英字にしてください。`
   - 自分の旧URLに戻す（to_event_id が自分）のは許可する
   - カテゴリは「保存後の主カテゴリ（category）」で判定する。categories（複数カテゴリ）の扱いは既存の解決ロジックに合わせ、判断した内容を報告に書く
3. 【転送の上書き】PATCH の `event_redirects` への `upsert(..., { onConflict: "from_category,from_slug" })` は、旧URLの組がすでに別の公演への転送として登録されていると、その転送先を上書きする
   - 直し方: 旧URLの組がすでに「別の公演への転送」として登録されているときは上書きしない（既存の行を残す）。自分への転送、または未登録のときだけ登録する。実装方法（先に select して分岐する／`ignoreDuplicates` など）は任せるが、選んだ理由と、同時に保存されたときの動きを報告に書く

【対象ファイル】
- app/events/[category]/[slug]/page.tsx
- app/api/theater/events/route.ts
- app/api/theater/events/[id]/route.ts
- （必要なら）lib/data/events.ts

【読む範囲】
- 読んでよい: CLAUDE.md、上の対象ファイル、lib/data/events.ts、lib/supabase/、docs/sql/001_init.sql（一意制約の確認）、app/api/admin/events/[id]/route.ts（運営者の更新でスラッグを変える経路があるかの確認だけ）
- 読まなくていい: node_modules・.next・content/・public/・scripts/

【完了条件】
- 1〜3 が入っていること
- 2026-11-27 に入れたスラッグの形式検査・承認済み劇団の公開制限・空の更新の扱いの挙動を変えないこと（既存のハーネス `/private/tmp/claude-501/-Users-nishiyamaakihiro/fe82cbc3-8585-4c48-af0b-a1999dd2dd91/scratchpad/slug-guard-check/route-harness/` の run.mjs と run-status.mjs が引き続き通ること）
- `npx tsc --noEmit --incremental false` がエラー 0 件、変更したファイルの eslint で新しいエラーが出ないこと
- ハーネスに次のケースを足して、実際に呼んで確かめる：
  - POST：(drama, old) が別公演への転送として登録済み → 409・書き込みなし／未登録 → 201
  - PATCH：別公演の旧URLへ変更 → 409／自分の旧URLへ戻す → 200／旧URLの組が別公演への転送として登録済みの状態でスラッグを変える → 転送は上書きされない／未登録 → 登録される
  - 公開ページの解決（page.tsx の解決部分を関数として呼べるなら呼ぶ。難しければ、入力（カテゴリ一致の有無・転送の有無・カテゴリ違いの候補の有無）ごとの結果をコードから表にする）

【背景】
- 2026-11-27 に、劇団がスラッグ欄に公式サイトのURLを入れていた 5 件をせおが英字に付け替え、旧URLを event_redirects に登録した。今回の変更でこの 5 件の転送が引き続き効くこと（既存行を消さない）
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
npx eslint "app/events/[category]/[slug]/page.tsx" app/api/theater/events/route.ts "app/api/theater/events/[id]/route.ts" lib/data/events.ts
</verification_loop>

<action_safety>
Keep changes tightly scoped to the stated task.
Avoid unrelated refactors, renames, or cleanup unless they are required for correctness.
Call out any risky or irreversible action before taking it.
子エージェント（Claude の Agent ツール）を使わず自分で実装する。レビューは外から別途回す。

【このタスクで触ってはいけないもの】
- DB・Supabase への接続、git commit / push / branch 操作、`npm run build`・`npm run dev`
- 対象ファイル以外の変更（必要だと判断したら、変えずに報告）
- 言いなりに直さない。この指示書に矛盾や穴があれば、根拠をつけて報告に書く
- 保証できないことを保証するふりをしない
</action_safety>

<structured_output_contract>
報告は次の 4 項目だけ:
1. 変更したファイル（`git status --short --untracked-files=all` の出力をそのまま）
2. 何をどう変えたか（ファイルごとに 2〜4 行）
3. 検証の結果（コマンドと出力の要点、ハーネスの表）
4. 未解決・気になる点
</structured_output_contract>
```

## 判定と適用（C-4・せお・2026-11-27）

ship（西山くん「上から順に改善する」）。Codex gpt-6.2-sol xhigh 3周（3周目は回帰と解消の確認だけ）＋実装担当の自己レビュー。最終周で High なし。

- 1周目で見つかり直したもの：劇団メンバーが PostgREST で events を直接書けて API の検査を全部迂回できる（→ migration 20261127140020 で events の INSERT/UPDATE/DELETE と promotions の FOR ALL を運営者だけに）／副カテゴリの一致で別公演の正式URLを奪える（→ 主カテゴリ一致を優先）／categories の未検証の値が `.in()` に入る（→ 形式検査で 400）／旧URL登録の競合の窓（→ 登録を更新の前に・登録エラーは 500）／副カテゴリの旧URLが残らない／下書きで URL を取り置ける（→ 公開ページに出ていた公演だけ登録）／A→B→A の自己転送
- 2周目で見つかり直したもの：副カテゴリ一致が有効な転送を隠す（→ 主一致→転送→副一致→候補の順）／転送先が非公開のとき別公演へ 308（→ 404）／下書きの公開で予約確認を通らない／副カテゴリ側の公演が別公演の正式URLを旧URLとして登録する／保存失敗で予約が残る主な原因（→ 新しい主カテゴリの組の重複を先に確かめて 409）
- 記録だけ（直さない）：トランザクション・ロックでの完全な直列化と登録行の巻き戻し／公開日が時間経過で来たときの予約確認／ブラウザが覚えた 308／unstable_cache の候補と詳細のずれ／運営・harvest・スカウトの経路の予約確認（どれも service_role か運営者）／形式外カテゴリの既存公演の編集（本番 0 件）／編集ページのカテゴリ不一致の誘導／categories の個数の上限／下書きに戻して URL を変えてから再公開すると旧URLが 404／副カテゴリを複数の公演が共有しているときの転送の向き／副カテゴリだけの予約衝突で 409 になる／ドキュメントの古い記述（docs/04・06）
- Codex 最終周の「フォームで選べるカテゴリがマスタに無い」は、本番の categories に 12 件すべてあることを確認（該当しない）
- 本番 DB：dry-run で対象1本を確認して `supabase db push --linked`。適用後の events は INSERT/UPDATE/DELETE が運営者だけ、SELECT の2本は従来どおり。promotions は運営者だけ
- 今後の選択肢（西山くんに相談）：副カテゴリの URL を「本物の URL」ではなく「タグ」として扱う（副カテゴリの URL は主カテゴリの URL へ転送するだけにする）と、URL の重なりの問題がほぼ無くなる。サイト内のリンクは主カテゴリの URL を使っている
- ハーネス：scratchpad/batch-b/harness（run-routes 29・run-page 15・run-r2 60・run-r3 33・run-edit-page 4、すべて ALL OK）。前回までのハーネス（スラッグ検査・承認済み劇団の公開制限）も同じ結果

-- 穴: theater_invites の "Theater members can manage invites"（FOR ALL・is_theater_member(theater_id) OR is_admin()）で、editor でもブラウザから直接招待を作成・変更・削除でき、API（app/api/theater/invite）の「owner だけ」「定員 2 件」の確認をすり抜けられた。
-- アプリの theater_invites の読み書き（app/api/theater/invite・app/api/theater/me）はすべて service_role なので RLS の影響を受けない。ログイン中の利用者のクライアントからは使っていない。
-- 運営者（is_admin()）だけが読み書きできる FOR ALL ポリシーに置き換える。関数 is_admin()・is_theater_member()、ほかのテーブルのポリシーは変えない。

DROP POLICY IF EXISTS "Theater members can manage invites" ON public.theater_invites;
DROP POLICY IF EXISTS "Admins can manage invites" ON public.theater_invites;
CREATE POLICY "Admins can manage invites"
ON public.theater_invites FOR ALL
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

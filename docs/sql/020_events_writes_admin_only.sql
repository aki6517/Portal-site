-- 穴: events の "Theater members can create events" / "Theater members can update events" / "Theater members can delete events"（TO authenticated・is_theater_member(theater_id) OR is_admin()）で、劇団メンバーがブラウザから PostgREST で events を直接 INSERT / UPDATE / DELETE でき、API（app/api/theater/events・app/api/theater/events/[id]）のスラッグの形式検査・カテゴリの形式検査・ほかの公演の旧URL（event_redirects）を使わせない確認・旧URLの転送登録をすべてすり抜けられた。
-- promotions の "Theater members can manage promotions for their events"（FOR ALL）も同じく、劇団メンバーがブラウザから直接書けた。
-- アプリで events に書いている箇所（app/api/theater/events の POST・app/api/theater/events/[id] の PATCH / DELETE・app/api/theater/profile・app/api/views・scripts/harvest）はすべて service_role なので RLS の影響を受けない。ログイン中の利用者のクライアントで書いているのは、運営者だけが通る app/api/admin/events/[id]（is_admin() で通る）だけ。promotions の読み書きは app/api/ai/generate-promotion の service_role の insert だけで、利用者のクライアントからは読みも書きもしていない。
-- そこで events の INSERT / UPDATE / DELETE と promotions の FOR ALL を、運営者（is_admin()）だけのポリシーに置き換える。events の INSERT / UPDATE の WITH CHECK にある「published にできるのは承認済み（approved）の劇団の公演だけ」の条件は、運営者にも今までどおり残す。
-- events の SELECT のポリシー（"Published events are viewable by everyone" / "Theater members can view their events"）、関数 is_admin()・is_theater_member()、ほかのテーブルのポリシーは変えない。
-- 何度流しても同じ結果になるよう、作るポリシーも先に DROP POLICY IF EXISTS する。

DROP POLICY IF EXISTS "Theater members can create events" ON public.events;
DROP POLICY IF EXISTS "Theater members can update events" ON public.events;
DROP POLICY IF EXISTS "Theater members can delete events" ON public.events;
DROP POLICY IF EXISTS "Admins can create events" ON public.events;
DROP POLICY IF EXISTS "Admins can update events" ON public.events;
DROP POLICY IF EXISTS "Admins can delete events" ON public.events;

CREATE POLICY "Admins can create events"
ON public.events FOR INSERT
TO authenticated
WITH CHECK (
  is_admin()
  AND (
    status <> 'published'
    OR EXISTS (
      SELECT 1
      FROM public.theaters t
      WHERE t.id = events.theater_id
        AND t.status = 'approved'
    )
  )
);

CREATE POLICY "Admins can update events"
ON public.events FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (
  is_admin()
  AND (
    status <> 'published'
    OR EXISTS (
      SELECT 1
      FROM public.theaters t
      WHERE t.id = events.theater_id
        AND t.status = 'approved'
    )
  )
);

CREATE POLICY "Admins can delete events"
ON public.events FOR DELETE
TO authenticated
USING (is_admin());

DROP POLICY IF EXISTS "Theater members can manage promotions for their events" ON public.promotions;
DROP POLICY IF EXISTS "Admins can manage promotions" ON public.promotions;

CREATE POLICY "Admins can manage promotions"
ON public.promotions FOR ALL
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

-- 穴: 公開の閲覧数 API（app/api/views・未ログインでも呼べる）は、ブラウザの cookie とインスタンスごとのメモリ上のレート制限でしか重複を除いておらず、cookie を送らずに API を直接叩けば同じ人が何度でも閲覧数（event_views_daily・events.views）を増やせた。加算も「読んでから +1 して書く」ので、同時に来ると数え漏れた。
-- そこで「同じ閲覧者（サーバーだけが知る鍵で作った HMAC-SHA256。生の IP・User-Agent は持たない）・同じ公演・同じ日（日本時間）」の印を event_view_marks に一意に入れ、入ったときだけ DB の中で 1 文ずつ加算する関数 record_event_view を作る。UA は利用者が変えられるので、同じ IP（の HMAC）・公演・日で数えるのは p_ip_limit 回までにする。呼べるのは service_role だけ。
-- 何度流しても同じ結果になるよう IF NOT EXISTS・CREATE OR REPLACE・DROP FUNCTION IF EXISTS を使う（REVOKE / GRANT も再実行してよい）。

CREATE TABLE IF NOT EXISTS public.event_view_marks (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  view_date date NOT NULL,
  viewer_hash text NOT NULL CHECK (viewer_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, view_date, viewer_hash)
);

COMMENT ON TABLE public.event_view_marks IS
  '閲覧数の重複よけの印（公演×日本時間の日付×閲覧者の HMAC-SHA256 の16進。ip_hash は同じ IP の上限を数えるための IP だけの HMAC）。service_role だけが読み書きする（RLS 有効・ポリシーなし）。古い印は record_event_view が消す';

ALTER TABLE public.event_view_marks ENABLE ROW LEVEL SECURITY;

-- RLS（ポリシーなし）に加えて、表の権限も service_role だけにしておく
REVOKE ALL ON TABLE public.event_view_marks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.event_view_marks TO service_role;

-- 古い印の削除用
CREATE INDEX IF NOT EXISTS idx_event_view_marks_view_date
  ON public.event_view_marks(view_date);

-- 同じ IP・公演・日の印を数える問い合わせ用
CREATE INDEX IF NOT EXISTS idx_event_view_marks_event_date_ip
  ON public.event_view_marks(event_id, view_date, ip_hash);

-- 引数が変わったので、前の形（3 引数）の関数が残らないように消す
DROP FUNCTION IF EXISTS public.record_event_view(uuid, date, text);

-- 同じ閲覧者・同じ公演・同じ日の閲覧は 1 回だけ数え、同じ IP・公演・日で数えるのは p_ip_limit 回まで。
-- 数えたら true、数えなければ false。
-- 同じ (公演, 日, IP) の呼び出しはトランザクション単位のアドバイザリーロックで 1 本ずつにするので、同時に来ても上限を超えない。
-- SECURITY INVOKER（既定）のまま: 呼べるのは service_role だけなので、権限を持ち上げる必要がない。
CREATE OR REPLACE FUNCTION public.record_event_view(
  p_event_id uuid,
  p_view_date date,
  p_viewer_hash text,
  p_ip_hash text,
  p_ip_limit integer
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ip_count bigint;
  v_inserted integer;
BEGIN
  -- 上限が渡っていないと「上限なし」になってしまうので止める
  IF p_ip_limit IS NULL OR p_ip_limit < 1 THEN
    RAISE EXCEPTION 'record_event_view: p_ip_limit must be >= 1' USING ERRCODE = '22023';
  END IF;

  -- 同じ (公演, 日, IP) の呼び出しを 1 本ずつにする（下の count から印の INSERT までに割り込ませない）。
  -- キーは 3 つから作る 64 ビットのハッシュ。別の組み合わせとたまたま同じキーになっても、待つだけで結果は変わらない。
  -- トランザクション単位のロックなので、この呼び出しの確定・取り消しで自動的に外れる。
  -- READ COMMITTED（既定）では、ロックを取ったあとの count は、前に待っていた呼び出しが確定させた印まで数える。
  PERFORM pg_advisory_xact_lock(
    hashtextextended('record_event_view|' || p_event_id::text || '|' || p_view_date::text || '|' || p_ip_hash, 0)
  );

  -- 同じ IP・公演・日の印がもう上限まであれば、印を入れずに数えない
  SELECT count(*) INTO v_ip_count
  FROM public.event_view_marks
  WHERE event_id = p_event_id
    AND view_date = p_view_date
    AND ip_hash = p_ip_hash;

  IF v_ip_count >= p_ip_limit THEN
    RETURN false;
  END IF;

  -- 印を入れる。同じ (公演, 日, 閲覧者) がもうあれば入らない（同時に来ても主キーで 1 件だけになる）
  INSERT INTO public.event_view_marks (event_id, view_date, viewer_hash, ip_hash)
  VALUES (p_event_id, p_view_date, p_viewer_hash, p_ip_hash)
  ON CONFLICT (event_id, view_date, viewer_hash) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN false;
  END IF;

  -- 日別の閲覧数: 主キー (event_id, view_date) で upsert し、1 文で +1（無い行は views = 1 で作る）
  INSERT INTO public.event_views_daily AS d (event_id, view_date, views)
  VALUES (p_event_id, p_view_date, 1)
  ON CONFLICT (event_id, view_date)
  DO UPDATE SET views = d.views + 1;

  -- 累計の閲覧数: 1 文で +1
  UPDATE public.events
  SET views = coalesce(views, 0) + 1
  WHERE id = p_event_id;

  -- 古い印を消す（p_view_date より 2 日以上前。重複よけと上限に使うのは当日の印だけ）
  DELETE FROM public.event_view_marks
  WHERE view_date <= p_view_date - 2;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.record_event_view(uuid, date, text, text, integer) IS
  '閲覧を 1 回数える（同じ閲覧者・公演・日本時間の日付なら数えず false、同じ IP・公演・日で p_ip_limit 回に達していても false）。app/api/views から service_role で呼ぶ';

REVOKE ALL ON FUNCTION public.record_event_view(uuid, date, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_event_view(uuid, date, text, text, integer) TO service_role;

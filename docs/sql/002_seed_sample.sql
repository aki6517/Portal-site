BEGIN;

-- ------------------------------------------------------------
-- サンプルデータ（公演・劇団・会場）
-- 何度も流しても大きく壊れないよう、既存名があれば再利用します。
-- ------------------------------------------------------------

WITH
theater_existing AS (
  SELECT id
  FROM theaters
  WHERE name = '福岡アクト劇団'
  LIMIT 1
),
theater_insert AS (
  INSERT INTO theaters (
    id, name, contact_email, website_url, description, logo_url, status
  )
  SELECT
    gen_random_uuid(),
    '福岡アクト劇団',
    'info@act-portal.example',
    'https://example.com',
    '福岡を拠点に活動する小劇場劇団。コメディから会話劇まで幅広く公演。',
    NULL,
    'approved'
  WHERE NOT EXISTS (SELECT 1 FROM theater_existing)
  RETURNING id
),
theater_row AS (
  SELECT id FROM theater_existing
  UNION ALL
  SELECT id FROM theater_insert
),
venue_a_existing AS (
  SELECT id FROM venues WHERE name = 'ぽんプラザホール' LIMIT 1
),
venue_a_insert AS (
  INSERT INTO venues (
    id, name, address, city, postal_code, capacity, url
  )
  SELECT
    gen_random_uuid(),
    'ぽんプラザホール',
    '福岡県福岡市博多区祇園町8-3',
    '福岡市',
    '812-0038',
    200,
    'https://www.ponplaza.jp/'
  WHERE NOT EXISTS (SELECT 1 FROM venue_a_existing)
  RETURNING id
),
venue_a AS (
  SELECT id FROM venue_a_existing
  UNION ALL
  SELECT id FROM venue_a_insert
),
venue_b_existing AS (
  SELECT id FROM venues WHERE name = '西鉄ホール' LIMIT 1
),
venue_b_insert AS (
  INSERT INTO venues (
    id, name, address, city, postal_code, capacity, url
  )
  SELECT
    gen_random_uuid(),
    '西鉄ホール',
    '福岡県福岡市中央区天神2-11-3',
    '福岡市',
    '810-0001',
    450,
    'https://www.nishitetsu-hall.jp/'
  WHERE NOT EXISTS (SELECT 1 FROM venue_b_existing)
  RETURNING id
),
venue_b AS (
  SELECT id FROM venue_b_existing
  UNION ALL
  SELECT id FROM venue_b_insert
),
inserted_events AS (
  INSERT INTO events (
    theater_id,
    category,
    slug,
    title,
    company,
    description,
    start_date,
    end_date,
    venue_id,
    venue,
    venue_address,
    price_general,
    price_student,
    tags,
    image_url,
    flyer_url,
    ticket_url,
    cast,
    status
  )
  VALUES
    (
      (SELECT id FROM theater_row LIMIT 1),
      'comedy',
      'yoake-no-coffee',
      '夜明けのコーヒー',
      '福岡アクト劇団',
      '夜明け前の喫茶店。そこに集う人々の小さな勇気と再出発を描くコメディ。',
      NOW() + INTERVAL '10 days',
      NOW() + INTERVAL '11 days',
      (SELECT id FROM venue_a LIMIT 1),
      'ぽんプラザホール',
      '福岡県福岡市博多区祇園町8-3',
      3500,
      2500,
      ARRAY['コメディ','学生歓迎'],
      NULL,
      'https://placehold.co/800x1000?text=Flyer+1',
      'https://example.com/tickets/yoake',
      '[{"name":"山田太郎","role":"主演"},{"name":"佐藤花","role":"相手役"}]'::jsonb,
      'published'
    ),
    (
      (SELECT id FROM theater_row LIMIT 1),
      'conversation',
      'ao-to-cider',
      '青とサイダー',
      '福岡アクト劇団',
      '放課後の屋上。青春と友情を描いた瑞々しい会話劇。',
      NOW() + INTERVAL '20 days',
      NOW() + INTERVAL '20 days',
      (SELECT id FROM venue_a LIMIT 1),
      'ぽんプラザホール',
      '福岡県福岡市博多区祇園町8-3',
      3000,
      2000,
      ARRAY['会話劇','青春'],
      NULL,
      'https://placehold.co/800x1000?text=Flyer+2',
      'https://example.com/tickets/ao',
      '[{"name":"高橋歩","role":"主人公"},{"name":"中村葵","role":"友人"}]'::jsonb,
      'published'
    ),
    (
      (SELECT id FROM theater_row LIMIT 1),
      'musical',
      'hoshifuru-yoru',
      '星降る夜に',
      '福岡アクト劇団',
      '星明かりの下で紡がれる、歌と踊りのミュージカル。',
      NOW() + INTERVAL '35 days',
      NOW() + INTERVAL '36 days',
      (SELECT id FROM venue_b LIMIT 1),
      '西鉄ホール',
      '福岡県福岡市中央区天神2-11-3',
      4800,
      3200,
      ARRAY['ミュージカル','ファミリー'],
      NULL,
      'https://placehold.co/800x1000?text=Flyer+3',
      'https://example.com/tickets/hoshi',
      '[{"name":"石井光","role":"歌い手"},{"name":"森ゆい","role":"ダンサー"}]'::jsonb,
      'published'
    ),
    (
      (SELECT id FROM theater_row LIMIT 1),
      'classic',
      'hakata-roman',
      '博多浪漫',
      '福岡アクト劇団',
      '博多の下町を舞台にした人情時代劇。',
      NOW() - INTERVAL '20 days',
      NOW() - INTERVAL '19 days',
      (SELECT id FROM venue_b LIMIT 1),
      '西鉄ホール',
      '福岡県福岡市中央区天神2-11-3',
      4000,
      2800,
      ARRAY['時代劇','人情'],
      NULL,
      'https://placehold.co/800x1000?text=Flyer+4',
      'https://example.com/tickets/hakata',
      '[{"name":"田中健","role":"語り部"}]'::jsonb,
      'published'
    )
  ON CONFLICT (category, slug)
  DO UPDATE SET
    title = EXCLUDED.title,
    company = EXCLUDED.company,
    description = EXCLUDED.description,
    start_date = EXCLUDED.start_date,
    end_date = EXCLUDED.end_date,
    venue_id = EXCLUDED.venue_id,
    venue = EXCLUDED.venue,
    venue_address = EXCLUDED.venue_address,
    price_general = EXCLUDED.price_general,
    price_student = EXCLUDED.price_student,
    tags = EXCLUDED.tags,
    image_url = EXCLUDED.image_url,
    flyer_url = EXCLUDED.flyer_url,
    ticket_url = EXCLUDED.ticket_url,
    cast = EXCLUDED.cast,
    status = EXCLUDED.status
  RETURNING id
)
INSERT INTO event_views_daily (event_id, view_date, views)
SELECT
  e.id,
  (CURRENT_DATE - gs)::date,
  (50 + (random() * 150)::int)
FROM inserted_events e
CROSS JOIN generate_series(0, 14) AS gs
ON CONFLICT (event_id, view_date) DO NOTHING;

COMMIT;

-- ------------------------------------------------------------
-- 劇団管理画面で自分のアカウントと紐付けたい場合
-- Supabase Auth -> Users から自分の user_id を取得し、以下の
-- 'YOUR-USER-ID' を置き換えて実行してください。
-- ------------------------------------------------------------
-- INSERT INTO theater_members (theater_id, user_id, role)
-- SELECT t.id, 'YOUR-USER-ID'::uuid, 'owner'
-- FROM theaters t
-- WHERE t.name = '福岡アクト劇団'
-- ON CONFLICT DO NOTHING;

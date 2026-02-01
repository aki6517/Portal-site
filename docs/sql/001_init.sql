BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS admins (
  user_id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO categories (id, name, icon, color, sort_order) VALUES
  ('comedy', 'コメディ', '😂', '#FFD93D', 1),
  ('conversation', '会話劇', '💬', '#FF6B9D', 2),
  ('musical', 'ミュージカル', '🎵', '#A78BFA', 3),
  ('classic', '古典・時代劇', '🏯', '#6BCF7F', 4),
  ('dance', 'ダンス', '💃', '#4ECDC4', 5),
  ('student', '学生演劇', '🎓', '#FFB74D', 6),
  ('conte', 'コント', '🎭', '#FF8A80', 7),
  ('experimental', '実験的', '🔬', '#B39DDB', 8),
  ('other', 'その他', '📌', '#90A4AE', 99)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  city TEXT NOT NULL DEFAULT '福岡市',
  postal_code TEXT,
  latitude FLOAT,
  longitude FLOAT,
  capacity INTEGER,
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS theaters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  website_url TEXT,
  sns_x_url TEXT,
  sns_instagram_url TEXT,
  sns_facebook_url TEXT,
  description TEXT,
  logo_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS theater_members (
  theater_id UUID NOT NULL REFERENCES theaters(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'editor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (theater_id, user_id)
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theater_id UUID NOT NULL REFERENCES theaters(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'other' REFERENCES categories(id),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  description TEXT,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ,
  venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
  venue TEXT,
  venue_address TEXT,
  venue_lat FLOAT,
  venue_lng FLOAT,
  price_general INTEGER,
  price_student INTEGER,
  tags TEXT[] DEFAULT '{}',
  image_url TEXT,
  flyer_url TEXT,
  ticket_url TEXT,
  "cast" JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  ai_confidence FLOAT CHECK (ai_confidence >= 0 AND ai_confidence <= 1),
  views INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_redirects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_category TEXT NOT NULL,
  from_slug TEXT NOT NULL,
  to_event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_views_daily (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  view_date DATE NOT NULL,
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, view_date)
);

CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('twitter', 'instagram', 'facebook')),
  text TEXT NOT NULL,
  hashtags TEXT[] DEFAULT '{}',
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_events_category_slug ON events(category, slug);
CREATE INDEX IF NOT EXISTS idx_events_theater_id ON events(theater_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_start_date ON events(start_date);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_event_redirects_from ON event_redirects(from_category, from_slug);
CREATE INDEX IF NOT EXISTS idx_event_redirects_to_event_id ON event_redirects(to_event_id);

CREATE INDEX IF NOT EXISTS idx_event_views_daily_view_date ON event_views_daily(view_date);

CREATE INDEX IF NOT EXISTS idx_theaters_status ON theaters(status);
CREATE INDEX IF NOT EXISTS idx_theater_members_user_id ON theater_members(user_id);

CREATE INDEX IF NOT EXISTS idx_promotions_event_id ON promotions(event_id);
CREATE INDEX IF NOT EXISTS idx_promotions_platform ON promotions(platform);

CREATE INDEX IF NOT EXISTS idx_venues_city ON venues(city);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at ON contact_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(status);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_theaters_updated_at ON theaters;
CREATE TRIGGER update_theaters_updated_at
BEFORE UPDATE ON theaters
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_events_updated_at ON events;
CREATE TRIGGER update_events_updated_at
BEFORE UPDATE ON events
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_event_redirects_updated_at ON event_redirects;
CREATE TRIGGER update_event_redirects_updated_at
BEFORE UPDATE ON event_redirects
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_event_views_daily_updated_at ON event_views_daily;
CREATE TRIGGER update_event_views_daily_updated_at
BEFORE UPDATE ON event_views_daily
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION is_theater_member(target_theater_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM theater_members m
    WHERE m.theater_id = target_theater_id
      AND m.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION prevent_theater_status_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status <> OLD.status THEN
    IF is_admin() OR auth.role() = 'service_role' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only admin can change theater status';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_theater_status_update ON theaters;
CREATE TRIGGER trg_prevent_theater_status_update
BEFORE UPDATE ON theaters
FOR EACH ROW
EXECUTE FUNCTION prevent_theater_status_update();

ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE theaters ENABLE ROW LEVEL SECURITY;
ALTER TABLE theater_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_redirects ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_views_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins row is viewable by self" ON admins;
CREATE POLICY "Admins row is viewable by self"
ON admins FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage admins" ON admins;
CREATE POLICY "Service role can manage admins"
ON admins FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view all theaters" ON theaters;
CREATE POLICY "Admins can view all theaters"
ON theaters FOR SELECT
USING (is_admin());

DROP POLICY IF EXISTS "Theater members can view their theater" ON theaters;
CREATE POLICY "Theater members can view their theater"
ON theaters FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM theater_members m
    WHERE m.theater_id = theaters.id
      AND m.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Authenticated users can create theater as pending" ON theaters;
CREATE POLICY "Authenticated users can create theater as pending"
ON theaters FOR INSERT
TO authenticated
WITH CHECK (status = 'pending');

DROP POLICY IF EXISTS "Theater members can update their theater" ON theaters;
CREATE POLICY "Theater members can update their theater"
ON theaters FOR UPDATE
TO authenticated
USING (is_theater_member(id) OR is_admin())
WITH CHECK (is_theater_member(id) OR is_admin());

DROP POLICY IF EXISTS "Theater members can view members" ON theater_members;
CREATE POLICY "Theater members can view members"
ON theater_members FOR SELECT
TO authenticated
USING (is_theater_member(theater_id) OR is_admin());

DROP POLICY IF EXISTS "Self can join as owner on onboarding" ON theater_members;
CREATE POLICY "Self can join as owner on onboarding"
ON theater_members FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() AND role = 'owner');

DROP POLICY IF EXISTS "Published events are viewable by everyone" ON events;
CREATE POLICY "Published events are viewable by everyone"
ON events FOR SELECT
USING (status = 'published');

DROP POLICY IF EXISTS "Theater members can view their events" ON events;
CREATE POLICY "Theater members can view their events"
ON events FOR SELECT
TO authenticated
USING (is_theater_member(theater_id) OR is_admin());

DROP POLICY IF EXISTS "Theater members can create events" ON events;
CREATE POLICY "Theater members can create events"
ON events FOR INSERT
TO authenticated
WITH CHECK (
  (is_theater_member(theater_id) OR is_admin())
  AND (
    status <> 'published'
    OR EXISTS (SELECT 1 FROM theaters t WHERE t.id = theater_id AND t.status = 'approved')
  )
);

DROP POLICY IF EXISTS "Theater members can update events" ON events;
CREATE POLICY "Theater members can update events"
ON events FOR UPDATE
TO authenticated
USING (is_theater_member(theater_id) OR is_admin())
WITH CHECK (
  (is_theater_member(theater_id) OR is_admin())
  AND (
    status <> 'published'
    OR EXISTS (SELECT 1 FROM theaters t WHERE t.id = theater_id AND t.status = 'approved')
  )
);

DROP POLICY IF EXISTS "Theater members can delete events" ON events;
CREATE POLICY "Theater members can delete events"
ON events FOR DELETE
TO authenticated
USING (is_theater_member(theater_id) OR is_admin());

DROP POLICY IF EXISTS "Categories are viewable by everyone" ON categories;
CREATE POLICY "Categories are viewable by everyone"
ON categories FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Venues are viewable by everyone" ON venues;
CREATE POLICY "Venues are viewable by everyone"
ON venues FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Admins can manage categories" ON categories;
CREATE POLICY "Admins can manage categories"
ON categories FOR ALL
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admins can manage venues" ON venues;
CREATE POLICY "Admins can manage venues"
ON venues FOR ALL
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Theater members can manage promotions for their events" ON promotions;
CREATE POLICY "Theater members can manage promotions for their events"
ON promotions FOR ALL
TO authenticated
USING (
  is_admin()
  OR EXISTS (
    SELECT 1
    FROM events e
    WHERE e.id = promotions.event_id
      AND is_theater_member(e.theater_id)
  )
)
WITH CHECK (
  is_admin()
  OR EXISTS (
    SELECT 1
    FROM events e
    WHERE e.id = promotions.event_id
      AND is_theater_member(e.theater_id)
  )
);

DROP POLICY IF EXISTS "Service role can manage redirects" ON event_redirects;
CREATE POLICY "Service role can manage redirects"
ON event_redirects FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage daily views" ON event_views_daily;
CREATE POLICY "Service role can manage daily views"
ON event_views_daily FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view contact messages" ON contact_messages;
CREATE POLICY "Admins can view contact messages"
ON contact_messages FOR SELECT
TO authenticated
USING (is_admin());

DROP POLICY IF EXISTS "Admins can update contact messages" ON contact_messages;
CREATE POLICY "Admins can update contact messages"
ON contact_messages FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Service role can manage contact messages" ON contact_messages;
CREATE POLICY "Service role can manage contact messages"
ON contact_messages FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMIT;

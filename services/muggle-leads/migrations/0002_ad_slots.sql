CREATE TABLE IF NOT EXISTS ad_slots (
  source_id TEXT NOT NULL,
  tab TEXT NOT NULL,
  position TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  image_url TEXT NOT NULL DEFAULT '',
  image_key TEXT,
  click_url TEXT NOT NULL DEFAULT '',
  alt TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  width TEXT NOT NULL DEFAULT 'clamp(190px, 17vw, 320px)',
  max_height TEXT NOT NULL DEFAULT '72vh',
  fit TEXT NOT NULL DEFAULT 'natural',
  background TEXT NOT NULL DEFAULT 'var(--color-bg-1)',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_id, tab, position)
);

CREATE INDEX IF NOT EXISTS idx_ad_slots_source_enabled ON ad_slots(source_id, enabled);

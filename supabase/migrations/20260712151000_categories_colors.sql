-- 後から追加された3カテゴリ（action/drama/serious）に色が未設定（NULL）のため、
-- カレンダー番組表の色分けで灰色フォールバックになる問題の修正。
-- 既存パレット（FFD93D/FF6B9D/A78BFA/6BCF7F/4ECDC4/FF8A80/B39DDB/90A4AE/FFB74D）と
-- 識別可能な色を割り当てる。手動で色が設定済みの場合は上書きしない（color IS NULL条件）。

UPDATE public.categories SET color = '#FF5252' WHERE id = 'action'  AND color IS NULL;
UPDATE public.categories SET color = '#64B5F6' WHERE id = 'drama'   AND color IS NULL;
UPDATE public.categories SET color = '#5C6BC0' WHERE id = 'serious' AND color IS NULL;

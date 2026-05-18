-- =====================================================
-- 001: Storage Buckets
-- images  : 로고·배너·프로필 이미지 (5MB)
-- map-images : 고해상도 맵 이미지 (150MB)
-- =====================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'images', 'images', true,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/svg+xml']
) ON CONFLICT (id) DO NOTHING;

CREATE POLICY IF NOT EXISTS "images_public_read"
  ON storage.objects FOR SELECT USING (bucket_id = 'images');
CREATE POLICY IF NOT EXISTS "images_auth_insert"
  ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'images');
CREATE POLICY IF NOT EXISTS "images_auth_update"
  ON storage.objects FOR UPDATE USING (bucket_id = 'images');
CREATE POLICY IF NOT EXISTS "images_auth_delete"
  ON storage.objects FOR DELETE USING (bucket_id = 'images');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'map-images', 'map-images', true,
  157286400,  -- 150MB
  ARRAY['image/jpeg','image/png','image/webp']
) ON CONFLICT (id) DO NOTHING;

CREATE POLICY IF NOT EXISTS "map_images_public_read"
  ON storage.objects FOR SELECT USING (bucket_id = 'map-images');
CREATE POLICY IF NOT EXISTS "map_images_auth_insert"
  ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'map-images');
CREATE POLICY IF NOT EXISTS "map_images_auth_update"
  ON storage.objects FOR UPDATE USING (bucket_id = 'map-images');
CREATE POLICY IF NOT EXISTS "map_images_auth_delete"
  ON storage.objects FOR DELETE USING (bucket_id = 'map-images');

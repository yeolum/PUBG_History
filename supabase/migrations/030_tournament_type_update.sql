-- =====================================================
-- 030: Tournament Type Values Update
-- online / lan → regional 로 통일
-- =====================================================

UPDATE tournaments SET type = 'regional' WHERE type IN ('online', 'lan');

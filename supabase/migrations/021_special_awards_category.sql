-- =====================================================
-- 021: Special Awards Category
-- 어워드에 그룹 레이블 추가 (예: "MVP Awards")
-- =====================================================

ALTER TABLE tournament_special_awards ADD COLUMN IF NOT EXISTS category TEXT;

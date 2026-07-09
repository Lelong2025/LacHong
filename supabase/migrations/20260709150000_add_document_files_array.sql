-- Thêm cột files (mảng JSON) vào documents để lưu danh sách file trực tiếp trong bản ghi
-- Mỗi file: { name, path, uploaded_at }

-- 1. Thêm cột files với default là mảng rỗng
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS files jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Migrate dữ liệu hiện tại từ document_files vào documents.files (nếu có)
UPDATE documents d
SET files = (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'name', df.file_name,
        'path', df.file_path,
        'uploaded_at', df.uploaded_at
      )
    ),
    '[]'::jsonb
  )
  FROM document_files df
  WHERE df.document_id = d.id
)
WHERE EXISTS (
  SELECT 1 FROM document_files df WHERE df.document_id = d.id
);

-- 3. Trigger function: tự động sync documents.files khi thêm/sửa/xóa document_files
CREATE OR REPLACE FUNCTION sync_document_files_to_document()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE documents
    SET files = (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'name', df.file_name,
            'path', df.file_path,
            'uploaded_at', df.uploaded_at
          )
        ),
        '[]'::jsonb
      )
      FROM document_files df
      WHERE df.document_id = OLD.document_id
    )
    WHERE id = OLD.document_id;
    RETURN OLD;
  ELSE
    UPDATE documents
    SET files = (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'name', df.file_name,
            'path', df.file_path,
            'uploaded_at', df.uploaded_at
          )
        ),
        '[]'::jsonb
      )
      FROM document_files df
      WHERE df.document_id = NEW.document_id
    )
    WHERE id = NEW.document_id;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sync_files_to_document ON document_files;

CREATE TRIGGER sync_files_to_document
  AFTER INSERT OR UPDATE OR DELETE ON document_files
  FOR EACH ROW
  EXECUTE FUNCTION sync_document_files_to_document();

-- 4. cho phép上传 file
UPDATE storage.objects SET ...
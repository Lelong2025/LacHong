-- Run this in Supabase Dashboard > SQL Editor
-- Fix sync_document_files_to_document trigger function

CREATE OR REPLACE FUNCTION sync_document_files_to_document()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE documents
    SET files = (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'name', df.name,
            'path', df.object_path,
            'created_at', df.created_at
          )
        ),
        '[]'::jsonb
      )
      FROM document_files df
      WHERE df.document_id = OLD.document_id
        AND df.deleted_at IS NULL
    )
    WHERE id = OLD.document_id;
    RETURN OLD;
  ELSE
    UPDATE documents
    SET files = (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'name', df.name,
            'path', df.object_path,
            'created_at', df.created_at
          )
        ),
        '[]'::jsonb
      )
      FROM document_files df
      WHERE df.document_id = NEW.document_id
        AND df.deleted_at IS NULL
    )
    WHERE id = NEW.document_id;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
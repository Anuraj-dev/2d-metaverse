-- PRD 14: private rooms are no longer password-gated. Entry is admin + knock/
-- approve, so the per-room key hash is obsolete. Drop it (idempotent).
ALTER TABLE rooms DROP COLUMN IF EXISTS key_hash;

-- Google accounts have no local password. Never link identities by email.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
CREATE TABLE IF NOT EXISTS oauth_identities (
  provider text NOT NULL CHECK (provider = 'google'),
  subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (provider, subject),
  UNIQUE (provider, user_id)
);

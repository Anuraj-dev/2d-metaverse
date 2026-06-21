CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(32) NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_normalized UNIQUE (username),
  CONSTRAINT users_username_lowercase CHECK (username = lower(username))
);

CREATE TABLE IF NOT EXISTS spaces (
  id text PRIMARY KEY,
  name varchar(100) NOT NULL,
  map_json_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id text PRIMARY KEY,
  space_id text NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  key_hash text NOT NULL,
  door_zone jsonb NOT NULL,
  capacity smallint NOT NULL CHECK (capacity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, id)
);

CREATE INDEX IF NOT EXISTS rooms_space_id_idx ON rooms(space_id);

CREATE TABLE IF NOT EXISTS seats (
  id integer NOT NULL,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  x real NOT NULL,
  y real NOT NULL,
  facing varchar(5) NOT NULL CHECK (facing IN ('down', 'left', 'right', 'up')),
  PRIMARY KEY (room_id, id)
);

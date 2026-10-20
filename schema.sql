CREATE TABLE IF NOT EXISTS notebook_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(24) NOT NULL UNIQUE,
  password_hash varchar(256) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notebook_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES notebook_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notebook_sessions_user_id_idx
  ON notebook_sessions(user_id);
CREATE INDEX IF NOT EXISTS notebook_sessions_expiry_idx
  ON notebook_sessions(expires_at);

CREATE TABLE IF NOT EXISTS saved_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES notebook_users(id) ON DELETE CASCADE,
  title varchar(120) NOT NULL,
  markdown text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_revisions_user_created_idx
  ON saved_revisions(user_id, created_at);

CREATE TABLE IF NOT EXISTS saved_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES notebook_users(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_questions_user_created_idx
  ON saved_questions(user_id, created_at);

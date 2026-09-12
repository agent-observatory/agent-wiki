CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY, login text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces(id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS api_keys(id uuid PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),workspace_id uuid NOT NULL REFERENCES workspaces(id),token_hash text NOT NULL UNIQUE,name text NOT NULL,scope text NOT NULL CHECK(scope IN ('read','ingest')),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS articles(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),title text NOT NULL,content text NOT NULL,kind text NOT NULL DEFAULT 'article' CHECK(kind IN ('article','memory','glossary')),folder text NOT NULL DEFAULT '',tags text[] NOT NULL DEFAULT '{}',aliases text[] NOT NULL DEFAULT '{}',revision int NOT NULL DEFAULT 1,source_id uuid,evidence_status text NOT NULL DEFAULT 'user_authored',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,UNIQUE(workspace_id,id));
CREATE TABLE IF NOT EXISTS revisions(workspace_id uuid NOT NULL,article_id uuid NOT NULL,revision int NOT NULL,title text NOT NULL,content text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(article_id,revision),FOREIGN KEY(workspace_id,article_id) REFERENCES articles(workspace_id,id));
CREATE TABLE IF NOT EXISTS sources(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),name text NOT NULL,content_hash text NOT NULL,object_key text NOT NULL,idempotency_key text NOT NULL,status text NOT NULL DEFAULT 'queued',error_code text,model text,attempt int NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,UNIQUE(workspace_id,idempotency_key),UNIQUE(workspace_id,id));
CREATE TABLE IF NOT EXISTS links(workspace_id uuid NOT NULL,from_id uuid NOT NULL,to_id uuid NOT NULL,relation text NOT NULL,PRIMARY KEY(from_id,to_id,relation),FOREIGN KEY(workspace_id,from_id) REFERENCES articles(workspace_id,id),FOREIGN KEY(workspace_id,to_id) REFERENCES articles(workspace_id,id));
CREATE INDEX IF NOT EXISTS article_title_trgm ON articles USING gin(title gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS article_content_trgm ON articles USING gin(content gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS article_workspace ON articles(workspace_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS source_workspace ON sources(workspace_id,created_at DESC);
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_owner ON workspaces;
CREATE POLICY workspace_owner ON workspaces USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['articles','revisions','sources','links'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('DROP POLICY IF EXISTS workspace_scope ON %I',t);
 EXECUTE format('CREATE POLICY workspace_scope ON %I USING (workspace_id::text=current_setting(''app.workspace_id'',true) AND EXISTS(SELECT 1 FROM workspaces w WHERE w.id=workspace_id)) WITH CHECK (workspace_id::text=current_setting(''app.workspace_id'',true) AND EXISTS(SELECT 1 FROM workspaces w WHERE w.id=workspace_id))',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO wiki_app;
GRANT USAGE ON SCHEMA public TO wiki_app;
GRANT CONNECT ON DATABASE agent_wiki TO wiki_app;

GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO wiki_admin;

ALTER TABLE sources ADD COLUMN IF NOT EXISTS queue_job_id uuid;

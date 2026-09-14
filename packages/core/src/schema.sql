CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY,login text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces(id uuid PRIMARY KEY,owner_id text NOT NULL REFERENCES users(id),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS api_keys(id uuid PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),workspace_id uuid NOT NULL REFERENCES workspaces(id),token_hash text NOT NULL UNIQUE,name text NOT NULL,scope text NOT NULL CHECK(scope IN ('read','source:write','publish','manage')),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sources(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),revision int NOT NULL DEFAULT 1 CHECK(revision=1),name text NOT NULL,kind text NOT NULL,origin text NOT NULL,content_hash text NOT NULL,payload_hash text NOT NULL,object_key text NOT NULL,line_count int NOT NULL,idempotency_key text NOT NULL,masked boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,UNIQUE(workspace_id,id),UNIQUE(workspace_id,idempotency_key));
CREATE TABLE IF NOT EXISTS publications(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),idempotency_key text NOT NULL,payload_hash text NOT NULL,producer jsonb NOT NULL,reason text NOT NULL,result jsonb,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,id),UNIQUE(workspace_id,idempotency_key));
CREATE TABLE IF NOT EXISTS articles(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),title text NOT NULL,content text NOT NULL,kind text NOT NULL CHECK(kind IN ('article','memory','glossary')),folder text NOT NULL DEFAULT '',tags text[] NOT NULL DEFAULT '{}',aliases text[] NOT NULL DEFAULT '{}',revision int NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,UNIQUE(workspace_id,id));
CREATE TABLE IF NOT EXISTS revisions(workspace_id uuid NOT NULL,article_id uuid NOT NULL,revision int NOT NULL,title text NOT NULL,content text NOT NULL,metadata jsonb NOT NULL,publication_id uuid NOT NULL,reviewed_at timestamptz,reviewed_by text REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,article_id,revision),FOREIGN KEY(workspace_id,article_id) REFERENCES articles(workspace_id,id),FOREIGN KEY(workspace_id,publication_id) REFERENCES publications(workspace_id,id));
CREATE TABLE IF NOT EXISTS claims(workspace_id uuid NOT NULL,article_id uuid NOT NULL,revision int NOT NULL,anchor text NOT NULL,text text NOT NULL,type text NOT NULL CHECK(type IN ('user_decision','observation','ai_inference','unconfirmed','author_statement')),PRIMARY KEY(workspace_id,article_id,revision,anchor),FOREIGN KEY(workspace_id,article_id,revision) REFERENCES revisions(workspace_id,article_id,revision));
CREATE TABLE IF NOT EXISTS evidence(workspace_id uuid NOT NULL,article_id uuid NOT NULL,revision int NOT NULL,anchor text NOT NULL,source_id uuid NOT NULL,source_revision int NOT NULL CHECK(source_revision=1),line_start int NOT NULL,line_end int NOT NULL,quote text NOT NULL,PRIMARY KEY(workspace_id,article_id,revision,anchor,source_id,line_start,line_end),FOREIGN KEY(workspace_id,article_id,revision,anchor) REFERENCES claims(workspace_id,article_id,revision,anchor),FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id));
CREATE TABLE IF NOT EXISTS links(workspace_id uuid NOT NULL,from_id uuid NOT NULL,to_id uuid NOT NULL,relation text NOT NULL CHECK(relation IN ('links_to','supersedes')),PRIMARY KEY(workspace_id,from_id,to_id,relation),FOREIGN KEY(workspace_id,from_id) REFERENCES articles(workspace_id,id),FOREIGN KEY(workspace_id,to_id) REFERENCES articles(workspace_id,id),CHECK(from_id<>to_id));
CREATE TABLE IF NOT EXISTS project_contexts(workspace_id uuid NOT NULL REFERENCES workspaces(id),tag text NOT NULL,article_id uuid NOT NULL,PRIMARY KEY(workspace_id,tag),FOREIGN KEY(workspace_id,article_id) REFERENCES articles(workspace_id,id));
CREATE INDEX IF NOT EXISTS article_title_trgm ON articles USING gin(title gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS article_content_trgm ON articles USING gin(content gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS article_workspace ON articles(workspace_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS source_workspace ON sources(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS source_session_order ON sources(workspace_id,origin,created_at,id) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS collection_streams(workspace_id uuid NOT NULL REFERENCES workspaces(id),id text NOT NULL,client text NOT NULL,session_id text NOT NULL,name text NOT NULL,last_position int NOT NULL DEFAULT -1,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id));
CREATE TABLE IF NOT EXISTS collection_events(workspace_id uuid NOT NULL,stream_id text NOT NULL,position int NOT NULL,content_hash text NOT NULL,source_id uuid NOT NULL,PRIMARY KEY(workspace_id,stream_id,position,content_hash),FOREIGN KEY(workspace_id,stream_id) REFERENCES collection_streams(workspace_id,id),FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id));
ALTER TABLE collection_events ADD COLUMN IF NOT EXISTS native_id text;
CREATE UNIQUE INDEX IF NOT EXISTS collection_native_event ON collection_events(workspace_id,stream_id,native_id,content_hash) WHERE native_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS collection_origins(workspace_id uuid NOT NULL,stream_id text NOT NULL,id text NOT NULL,machine text NOT NULL,file_id text NOT NULL,generation uuid NOT NULL,byte_end bigint NOT NULL DEFAULT 0,record_end int NOT NULL DEFAULT 0,prefix_hash text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,stream_id) REFERENCES collection_streams(workspace_id,id));
CREATE TABLE IF NOT EXISTS collection_uploads(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,stream_id text NOT NULL,origin_id text NOT NULL,fingerprint text NOT NULL,manifest jsonb NOT NULL,compressed_bytes bigint NOT NULL,status text NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','queued','verifying','completed','failed','expired')),grants jsonb NOT NULL DEFAULT '{}',result jsonb,error_code text,lease_until timestamptz,expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,fingerprint),FOREIGN KEY(workspace_id,origin_id) REFERENCES collection_origins(workspace_id,id));
ALTER TABLE sources ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS ai_settings(workspace_id uuid PRIMARY KEY REFERENCES workspaces(id),config jsonb NOT NULL,encrypted_key text,version int NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now());
-- Free mode is retired; preserve explicit BYOK settings and erase unused profiles.
UPDATE ai_settings SET config='{"mode":"byok","enabled":false}'::jsonb, encrypted_key=NULL,version=version+1 WHERE config->>'mode'='free';
ALTER TABLE ai_settings DROP COLUMN IF EXISTS profiles;
CREATE TABLE IF NOT EXISTS refinement_jobs(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,source_id uuid NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),attempts int NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,run_id uuid,output jsonb,result jsonb,error_code text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,source_id),FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id));
CREATE TABLE IF NOT EXISTS refinement_runs(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,job_id uuid NOT NULL REFERENCES refinement_jobs(id),settings jsonb NOT NULL,prompt_version text NOT NULL,input jsonb NOT NULL DEFAULT '{}',output jsonb,usage jsonb,status text NOT NULL DEFAULT 'running',error_code text,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz);
ALTER TABLE refinement_runs ADD COLUMN IF NOT EXISTS output jsonb;
ALTER TABLE refinement_runs ADD COLUMN IF NOT EXISTS chunk_index int;
ALTER TABLE refinement_runs ADD COLUMN IF NOT EXISTS diagnostics jsonb NOT NULL DEFAULT '{}';
ALTER TABLE refinement_jobs ADD COLUMN IF NOT EXISTS chunk_plan jsonb;
ALTER TABLE refinement_jobs ADD COLUMN IF NOT EXISTS chunk_index int NOT NULL DEFAULT 0;
ALTER TABLE refinement_jobs ADD COLUMN IF NOT EXISTS chunk_count int NOT NULL DEFAULT 0;
ALTER TABLE refinement_jobs ADD COLUMN IF NOT EXISTS chunk_results jsonb NOT NULL DEFAULT '[]';
ALTER TABLE refinement_jobs ADD COLUMN IF NOT EXISTS generation int NOT NULL DEFAULT 0;
ALTER TABLE refinement_jobs ADD COLUMN IF NOT EXISTS batch_parent uuid REFERENCES refinement_jobs(id);
ALTER TABLE refinement_jobs ADD COLUMN IF NOT EXISTS input_sources jsonb;
ALTER TABLE refinement_jobs ADD COLUMN IF NOT EXISTS cycle_id uuid;
ALTER TABLE refinement_jobs ADD COLUMN IF NOT EXISTS cycle_started_at timestamptz;
CREATE INDEX IF NOT EXISTS refinement_batch_parent ON refinement_jobs(workspace_id,batch_parent);
CREATE TABLE IF NOT EXISTS curation_rebuilds(id uuid NOT NULL,workspace_id uuid NOT NULL REFERENCES workspaces(id),result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id));
CREATE INDEX IF NOT EXISTS refinement_ready ON refinement_jobs(workspace_id,status,available_at);
CREATE INDEX IF NOT EXISTS refinement_daily ON refinement_runs(workspace_id,created_at);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS subject text NOT NULL DEFAULT '';
ALTER TABLE claims ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT '';
ALTER TABLE claims ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'current' CHECK(state IN ('current','proposed','superseded','retracted','conflicted','unconfirmed'));
CREATE TABLE IF NOT EXISTS claim_relations(workspace_id uuid NOT NULL,from_article_id uuid NOT NULL,from_revision int NOT NULL,from_anchor text NOT NULL,to_article_id uuid NOT NULL,to_revision int NOT NULL,to_anchor text NOT NULL,relation text NOT NULL CHECK(relation IN ('supersedes','retracts','contradicts','supports')),evidence jsonb NOT NULL,publication_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,from_article_id,from_revision,from_anchor,to_article_id,to_revision,to_anchor,relation),FOREIGN KEY(workspace_id,from_article_id,from_revision,from_anchor) REFERENCES claims(workspace_id,article_id,revision,anchor),FOREIGN KEY(workspace_id,to_article_id,to_revision,to_anchor) REFERENCES claims(workspace_id,article_id,revision,anchor),FOREIGN KEY(workspace_id,publication_id) REFERENCES publications(workspace_id,id));
CREATE INDEX IF NOT EXISTS claim_relation_target ON claim_relations(workspace_id,to_article_id,to_revision,to_anchor);
CREATE TABLE IF NOT EXISTS knowledge_reviews(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,article_id uuid NOT NULL,revision int NOT NULL,snapshot jsonb NOT NULL,snapshot_hash text NOT NULL,reviewer jsonb NOT NULL,reason text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(workspace_id,article_id,revision) REFERENCES revisions(workspace_id,article_id,revision) ON DELETE CASCADE,UNIQUE(workspace_id,article_id,revision,snapshot_hash));
CREATE INDEX IF NOT EXISTS knowledge_review_baseline ON knowledge_reviews(workspace_id,article_id,revision DESC,created_at DESC);
CREATE TABLE IF NOT EXISTS model_request_gates(owner_id text NOT NULL REFERENCES users(id),key_hash text NOT NULL,next_allowed_at timestamptz NOT NULL DEFAULT now(),failures int NOT NULL DEFAULT 0,PRIMARY KEY(owner_id,key_hash));
ALTER TABLE model_request_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_request_gates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gate_owner ON model_request_gates;
CREATE POLICY gate_owner ON model_request_gates USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_owner ON workspaces;
CREATE POLICY workspace_owner ON workspaces USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS stopped_reason text;
ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS stopped_at timestamptz;
ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS fallback_active_since timestamptz;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS topic_key text NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS topic_title text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS wiki_pages(workspace_id uuid NOT NULL REFERENCES workspaces(id),id uuid NOT NULL,topic_key text NOT NULL,title text NOT NULL,content text NOT NULL,revision int NOT NULL,input_hash text NOT NULL,tags text[] NOT NULL DEFAULT '{}',updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,topic_key));
CREATE TABLE IF NOT EXISTS wiki_page_versions(workspace_id uuid NOT NULL,page_id uuid NOT NULL,revision int NOT NULL,title text NOT NULL,content text NOT NULL,snapshot jsonb NOT NULL,input_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,page_id,revision),FOREIGN KEY(workspace_id,page_id) REFERENCES wiki_pages(workspace_id,id));
CREATE TABLE IF NOT EXISTS source_record_times(workspace_id uuid NOT NULL,source_id uuid NOT NULL,line int NOT NULL,recorded_at timestamptz NOT NULL,time_kind text NOT NULL,PRIMARY KEY(workspace_id,source_id,line),FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id));
CREATE TABLE IF NOT EXISTS curation_reprocesses(workspace_id uuid NOT NULL,id uuid NOT NULL,original_run_id uuid NOT NULL REFERENCES refinement_runs(id),mode text NOT NULL,status text NOT NULL DEFAULT 'pending',reason text NOT NULL,plan jsonb NOT NULL,run_id uuid REFERENCES refinement_runs(id),candidate jsonb,error_code text,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id));
CREATE TABLE IF NOT EXISTS retrieval_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),trace_id uuid NOT NULL,stage text NOT NULL,query_hash text,view text,response_chars int NOT NULL,duration_ms int NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS retrieval_events_trace ON retrieval_events(workspace_id,trace_id,created_at);
-- Consolidation (design in docs/l2-l3-memory.md): a relation-only publish
-- failure carries its intended relation here instead of discarding the whole
-- extraction; the next Consolidation Job for that topic resolves it.
CREATE TABLE IF NOT EXISTS consolidation_inbox(workspace_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),from_article_id uuid NOT NULL,from_revision int NOT NULL,from_anchor text NOT NULL,to_article_id uuid NOT NULL,to_revision int NOT NULL,to_anchor text NOT NULL,relation text NOT NULL CHECK(relation IN ('supersedes','retracts','contradicts','supports')),evidence jsonb NOT NULL,source_run_id uuid,error_code text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved')),resolved_job_id uuid,created_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz,PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,from_article_id,from_revision,from_anchor) REFERENCES claims(workspace_id,article_id,revision,anchor));
CREATE INDEX IF NOT EXISTS consolidation_inbox_pending ON consolidation_inbox(workspace_id,from_article_id) WHERE status='pending';
-- One open Job (pending/running) per topic at a time; a Job is 4 Steps
-- (gather/model/validate/publish) each independently tracked in `steps`.
CREATE TABLE IF NOT EXISTS consolidation_jobs(workspace_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),topic_key text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),trigger text NOT NULL CHECK(trigger IN ('cycle','deferred','manual')),attempt int NOT NULL DEFAULT 0,rerun_requested boolean NOT NULL DEFAULT false,step_names text[] NOT NULL DEFAULT ARRAY['gather','model','validate','publish'],steps jsonb NOT NULL DEFAULT '{}',current_step text,run_ids uuid[] NOT NULL DEFAULT '{}',result jsonb,available_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,error_code text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id));
CREATE UNIQUE INDEX IF NOT EXISTS consolidation_jobs_open ON consolidation_jobs(workspace_id,topic_key) WHERE status IN ('pending','running');
-- Reverses an auto-applied relation via a corrective Version (no deletes);
-- remembered so gather/model never re-propose the same rejected relation.
-- publication_id is null for a 'supports' rejection: that relation never
-- changed an effective state, so there is no corrective Version to point at.
CREATE TABLE IF NOT EXISTS claim_relation_rejections(workspace_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),from_article_id uuid NOT NULL,from_revision int NOT NULL,from_anchor text NOT NULL,to_article_id uuid NOT NULL,to_revision int NOT NULL,to_anchor text NOT NULL,relation text NOT NULL CHECK(relation IN ('supersedes','retracts','contradicts','supports')),reason text NOT NULL,publication_id uuid,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,publication_id) REFERENCES publications(workspace_id,id));
CREATE INDEX IF NOT EXISTS claim_relation_rejections_from ON claim_relation_rejections(workspace_id,from_article_id,from_anchor);
-- Consolidation model calls share refinement_runs (call history, daily budget,
-- diagnostics) with extraction; job_id is extraction-only, consolidation_job_id
-- is the sibling for the other kind, never both.
ALTER TABLE refinement_runs ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE refinement_runs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'extraction';
ALTER TABLE refinement_runs ADD COLUMN IF NOT EXISTS consolidation_job_id uuid;
ALTER TABLE refinement_runs DROP CONSTRAINT IF EXISTS refinement_runs_kind_check;
ALTER TABLE refinement_runs ADD CONSTRAINT refinement_runs_kind_check CHECK(kind IN ('extraction','consolidation'));
ALTER TABLE refinement_runs DROP CONSTRAINT IF EXISTS refinement_runs_kind_job_check;
ALTER TABLE refinement_runs ADD CONSTRAINT refinement_runs_kind_job_check CHECK((kind='extraction' AND job_id IS NOT NULL AND consolidation_job_id IS NULL) OR (kind='consolidation' AND consolidation_job_id IS NOT NULL AND job_id IS NULL));
ALTER TABLE refinement_runs DROP CONSTRAINT IF EXISTS refinement_runs_consolidation_job_id_fkey;
ALTER TABLE refinement_runs ADD CONSTRAINT refinement_runs_consolidation_job_id_fkey FOREIGN KEY(workspace_id,consolidation_job_id) REFERENCES consolidation_jobs(workspace_id,id);
CREATE INDEX IF NOT EXISTS refinement_consolidation ON refinement_runs(workspace_id,consolidation_job_id) WHERE consolidation_job_id IS NOT NULL;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['retrieval_events','curation_reprocesses','source_record_times','wiki_pages','wiki_page_versions','articles','revisions','sources','links','publications','claims','evidence','project_contexts','collection_streams','collection_events','collection_origins','collection_uploads','ai_settings','refinement_jobs','refinement_runs','claim_relations','curation_rebuilds','knowledge_reviews','consolidation_inbox','consolidation_jobs','claim_relation_rejections'] LOOP
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

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_scope_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_scope_check CHECK(scope IN ('read','source:write','publish','manage'));

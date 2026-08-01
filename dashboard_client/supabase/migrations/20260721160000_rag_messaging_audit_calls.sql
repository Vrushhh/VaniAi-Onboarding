-- Migration: RAG Knowledge Base, Messaging Config/Templates, Audit Logs, Calls Table and Dashboard KPIs
-- File suggestion: supabase/migrations/20260721160000_rag_messaging_audit_calls.sql

-- Enable the pgvector extension (locked in by TRD)
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 1. Knowledge Base (Feature #22)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.knowledge_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  file_path   text,
  status      text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  error_message text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id   uuid NOT NULL REFERENCES public.knowledge_sources(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  content     text NOT NULL,
  embedding   vector(1024),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Cosine distance indexing using ivfflat
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx ON public.knowledge_chunks USING ivfflat (embedding vector_cosine_ops);

ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members view knowledge sources" ON public.knowledge_sources;
CREATE POLICY "Org members view knowledge sources"
  ON public.knowledge_sources FOR SELECT USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Editors and owners manage knowledge sources" ON public.knowledge_sources;
CREATE POLICY "Editors and owners manage knowledge sources"
  ON public.knowledge_sources FOR ALL
  USING (public.is_org_owner(org_id) OR EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = knowledge_sources.org_id AND user_id = auth.uid() AND role IN ('owner','editor')))
  WITH CHECK (public.is_org_owner(org_id) OR EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = knowledge_sources.org_id AND user_id = auth.uid() AND role IN ('owner','editor')));

DROP POLICY IF EXISTS "Org members view knowledge chunks" ON public.knowledge_chunks;
CREATE POLICY "Org members view knowledge chunks"
  ON public.knowledge_chunks FOR SELECT USING (public.is_org_member(org_id));

-- RAG Cosine search RPC
CREATE OR REPLACE FUNCTION public.search_knowledge(
  _org_id uuid, _query_embedding vector(1024), _top_k int DEFAULT 3
) RETURNS TABLE(content text, similarity float)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT content, 1 - (embedding <=> _query_embedding) AS similarity
  FROM public.knowledge_chunks
  WHERE org_id = _org_id
  ORDER BY embedding <=> _query_embedding
  LIMIT _top_k;
$$;

GRANT EXECUTE ON FUNCTION public.search_knowledge(uuid, vector(1024), int) TO authenticated;

-- ============================================================
-- 2. SMS & WhatsApp Messaging Config (Feature #23)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.messaging_config (
  org_id        uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  api_key       text NOT NULL,
  api_secret    text,
  sender_id     text,
  whatsapp_enabled boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.messaging_config ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.messaging_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  template    text NOT NULL,
  variables   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.messaging_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members view templates" ON public.messaging_templates;
CREATE POLICY "Org members view templates"
  ON public.messaging_templates FOR SELECT USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Editors and owners manage templates" ON public.messaging_templates;
CREATE POLICY "Editors and owners manage templates"
  ON public.messaging_templates FOR ALL
  USING (public.is_org_owner(org_id) OR EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = messaging_templates.org_id AND user_id = auth.uid() AND role IN ('owner','editor')))
  WITH CHECK (public.is_org_owner(org_id) OR EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = messaging_templates.org_id AND user_id = auth.uid() AND role IN ('owner','editor')));

CREATE OR REPLACE FUNCTION public.set_messaging_config(
  _org_id uuid, _provider text, _api_key text, _api_secret text, _sender_id text, _whatsapp_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_org_owner(_org_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Only owners can set messaging config');
  END IF;
  INSERT INTO public.messaging_config (org_id, provider, api_key, api_secret, sender_id, whatsapp_enabled, updated_at)
  VALUES (_org_id, _provider, _api_key, _api_secret, _sender_id, _whatsapp_enabled, now())
  ON CONFLICT (org_id) DO UPDATE SET
    provider = EXCLUDED.provider, api_key = EXCLUDED.api_key, api_secret = EXCLUDED.api_secret,
    sender_id = EXCLUDED.sender_id, whatsapp_enabled = EXCLUDED.whatsapp_enabled, updated_at = now();
  RETURN jsonb_build_object('success', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.set_messaging_config(uuid, text, text, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_messaging_config(_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cfg record;
BEGIN
  IF NOT public.is_org_member(_org_id) THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO cfg FROM public.messaging_config WHERE org_id = _org_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  RETURN jsonb_build_object(
    'found', true, 'provider', cfg.provider, 'sender_id', cfg.sender_id,
    'whatsapp_enabled', cfg.whatsapp_enabled,
    'api_key_masked', repeat('•', 8) || right(cfg.api_key, 4),
    'updated_at', cfg.updated_at
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.get_messaging_config(uuid) TO authenticated;

-- ============================================================
-- 3. Audit Log (Feature #25)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  actor_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,  -- Reference profiles table directly for easy PostgREST joins
  action      text NOT NULL,
  target_type text,
  target_id   uuid,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_org ON public.audit_log(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log(created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners view their org audit log" ON public.audit_log;
CREATE POLICY "Owners view their org audit log"
  ON public.audit_log FOR SELECT
  USING (public.is_org_owner(org_id) OR public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.log_audit_event(
  _org_id uuid, _action text, _target_type text, _target_id uuid, _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_log (org_id, actor_id, action, target_type, target_id, metadata)
  VALUES (_org_id, auth.uid(), _action, _target_type, _target_id, _metadata);
END; $$;

GRANT EXECUTE ON FUNCTION public.log_audit_event(uuid, text, text, uuid, jsonb) TO authenticated;

-- ============================================================
-- 4. Triggers to Automate Auditing
-- ============================================================

-- Re-define admin_set_org_status to also log audit events
CREATE OR REPLACE FUNCTION public.admin_set_org_status(_org_id uuid, _status text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  action_name text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authorized');
  END IF;
  IF _status NOT IN ('active', 'suspended') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid status');
  END IF;
  
  UPDATE public.organizations SET status = _status WHERE id = _org_id;
  
  IF _status = 'suspended' THEN
    action_name := 'org.suspended';
  ELSE
    action_name := 'org.activated';
  END IF;
  
  PERFORM public.log_audit_event(_org_id, action_name, 'organization', _org_id);
  
  RETURN jsonb_build_object('success', true);
END; $$;

-- Organization deletion audit trigger
CREATE OR REPLACE FUNCTION public.log_org_delete_trigger()
RETURNS trigger AS $$
BEGIN
  PERFORM public.log_audit_event(
    OLD.id, 
    'org.deleted', 
    'organization', 
    OLD.id, 
    jsonb_build_object('org_name', OLD.name)
  );
  RETURN OLD;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE TRIGGER log_org_delete_trg
  BEFORE DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.log_org_delete_trigger();

-- Organization members update/delete audit trigger
CREATE OR REPLACE FUNCTION public.log_org_member_audit_trigger()
RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'UPDATE') THEN
    IF (OLD.role <> NEW.role) THEN
      PERFORM public.log_audit_event(
        NEW.org_id, 
        'member.role_changed', 
        'org_member', 
        NEW.user_id, 
        jsonb_build_object('old_role', OLD.role, 'new_role', NEW.role)
      );
    END IF;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    PERFORM public.log_audit_event(
      OLD.org_id, 
      'member.removed', 
      'org_member', 
      OLD.user_id, 
      jsonb_build_object('role', OLD.role)
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE TRIGGER log_org_member_audit_trg
  AFTER UPDATE OR DELETE ON public.org_members
  FOR EACH ROW EXECUTE FUNCTION public.log_org_member_audit_trigger();

-- Organization invitation insert/delete audit trigger
CREATE OR REPLACE FUNCTION public.log_org_invite_audit_trigger()
RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    PERFORM public.log_audit_event(
      NEW.org_id, 
      'invite.created', 
      'org_invite', 
      NEW.id, 
      jsonb_build_object('email', NEW.email, 'role', NEW.role)
    );
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    PERFORM public.log_audit_event(
      OLD.org_id, 
      'invite.revoked', 
      'org_invite', 
      OLD.id, 
      jsonb_build_object('email', OLD.email, 'role', OLD.role)
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE TRIGGER log_org_invite_audit_trg
  AFTER INSERT OR DELETE ON public.org_invites
  FOR EACH ROW EXECUTE FUNCTION public.log_org_invite_audit_trigger();

-- ============================================================
-- 5. Calls Database (Feature #21)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id        uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  flow_version_id uuid REFERENCES public.flow_versions(id) ON DELETE SET NULL,
  direction       text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  phone_number    text NOT NULL,
  status          text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'failed', 'missed', 'no_answer')),
  duration_seconds int,
  recording_url   text,
  transcript      jsonb,
  outcome         text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_calls_org_started ON public.calls(org_id, started_at DESC);

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members view their calls" ON public.calls;
CREATE POLICY "Org members view their calls"
  ON public.calls FOR SELECT USING (public.is_org_member(org_id));

-- ============================================================
-- 6. Analytics Dashboard RPC (Feature #24)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(_org_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'calls_today', COALESCE((SELECT count(*) FROM public.calls
                     WHERE org_id = _org_id AND started_at >= current_date), 0),
    'completed_today', COALESCE((SELECT count(*) FROM public.calls
                         WHERE org_id = _org_id AND started_at >= current_date AND status = 'completed'), 0),
    'avg_duration_seconds', COALESCE((SELECT round(avg(duration_seconds)) FROM public.calls
                              WHERE org_id = _org_id AND started_at >= current_date AND duration_seconds IS NOT NULL), 0)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_kpis(uuid) TO authenticated;

-- ============================================================
-- 7. Supabase Storage Bucket setup
-- ============================================================

-- Create storage bucket for knowledge base documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-docs', 'knowledge-docs', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for storage bucket object access matching org membership
DROP POLICY IF EXISTS "Org members select knowledge-docs objects" ON storage.objects;
CREATE POLICY "Org members select knowledge-docs objects"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'knowledge-docs' AND public.is_org_member(uuid((storage.foldername(name))[1])));

DROP POLICY IF EXISTS "Org editors/owners manage knowledge-docs objects" ON storage.objects;
CREATE POLICY "Org editors/owners manage knowledge-docs objects"
  ON storage.objects FOR ALL
  USING (bucket_id = 'knowledge-docs' AND (
    public.is_org_owner(uuid((storage.foldername(name))[1])) OR EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_id = uuid((storage.foldername(name))[1]) AND user_id = auth.uid() AND role IN ('owner','editor')
    )
  ));

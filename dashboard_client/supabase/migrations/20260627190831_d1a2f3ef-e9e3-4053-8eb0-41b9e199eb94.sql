
-- Roles enum
CREATE TYPE public.org_role AS ENUM ('owner', 'editor', 'viewer');

-- Organizations
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Org members
CREATE TABLE public.org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.org_role NOT NULL DEFAULT 'viewer',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);
CREATE INDEX idx_org_members_user ON public.org_members(user_id);
CREATE INDEX idx_org_members_org ON public.org_members(org_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_members TO authenticated;
GRANT ALL ON public.org_members TO service_role;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

-- Security definer helpers
CREATE OR REPLACE FUNCTION public.is_org_member(_org_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_members WHERE org_id = _org_id AND user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.org_role_of(_org_id uuid, _user_id uuid)
RETURNS public.org_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.org_members WHERE org_id = _org_id AND user_id = _user_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.can_edit_org(_org_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = _org_id AND user_id = _user_id AND role IN ('owner', 'editor')
  )
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner(_org_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = _org_id AND user_id = _user_id AND role = 'owner'
  )
$$;

-- Trigger: when an organization is created, make the creator an owner
CREATE OR REPLACE FUNCTION public.add_creator_as_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (NEW.id, auth.uid(), 'owner')
    ON CONFLICT (org_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_org_creator_owner
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.add_creator_as_owner();

-- Organization policies
CREATE POLICY "Members can view their orgs" ON public.organizations
FOR SELECT TO authenticated USING (public.is_org_member(id, auth.uid()));

CREATE POLICY "Any authed user can create an org" ON public.organizations
FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Owners can update their org" ON public.organizations
FOR UPDATE TO authenticated USING (public.is_org_owner(id, auth.uid()))
WITH CHECK (public.is_org_owner(id, auth.uid()));

CREATE POLICY "Owners can delete their org" ON public.organizations
FOR DELETE TO authenticated USING (public.is_org_owner(id, auth.uid()));

-- Org members policies
CREATE POLICY "Members can view org members" ON public.org_members
FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()));

CREATE POLICY "Owners can add members" ON public.org_members
FOR INSERT TO authenticated WITH CHECK (public.is_org_owner(org_id, auth.uid()));

CREATE POLICY "Owners can update members" ON public.org_members
FOR UPDATE TO authenticated USING (public.is_org_owner(org_id, auth.uid()))
WITH CHECK (public.is_org_owner(org_id, auth.uid()));

CREATE POLICY "Owners can remove members; users can remove themselves" ON public.org_members
FOR DELETE TO authenticated USING (
  public.is_org_owner(org_id, auth.uid()) OR user_id = auth.uid()
);

-- Agents
CREATE TABLE public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  language text NOT NULL DEFAULT 'en-IN',
  direction text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_agents_org ON public.agents(org_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agents TO authenticated;
GRANT ALL ON public.agents TO service_role;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view agents" ON public.agents
FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY "Editors create agents" ON public.agents
FOR INSERT TO authenticated WITH CHECK (public.can_edit_org(org_id, auth.uid()));
CREATE POLICY "Editors update agents" ON public.agents
FOR UPDATE TO authenticated USING (public.can_edit_org(org_id, auth.uid()))
WITH CHECK (public.can_edit_org(org_id, auth.uid()));
CREATE POLICY "Editors delete agents" ON public.agents
FOR DELETE TO authenticated USING (public.can_edit_org(org_id, auth.uid()));

-- Flows
CREATE TABLE public.flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  name text NOT NULL,
  draft_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_version_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_flows_agent ON public.flows(agent_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flows TO authenticated;
GRANT ALL ON public.flows TO service_role;
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;

-- Helper: org_id reachable via a flow
CREATE OR REPLACE FUNCTION public.flow_org(_flow_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.org_id FROM public.flows f
  JOIN public.agents a ON a.id = f.agent_id
  WHERE f.id = _flow_id
$$;

CREATE OR REPLACE FUNCTION public.agent_org(_agent_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.agents WHERE id = _agent_id
$$;

CREATE POLICY "Members view flows" ON public.flows
FOR SELECT TO authenticated USING (public.is_org_member(public.agent_org(agent_id), auth.uid()));
CREATE POLICY "Editors create flows" ON public.flows
FOR INSERT TO authenticated WITH CHECK (public.can_edit_org(public.agent_org(agent_id), auth.uid()));
CREATE POLICY "Editors update flows" ON public.flows
FOR UPDATE TO authenticated USING (public.can_edit_org(public.agent_org(agent_id), auth.uid()))
WITH CHECK (public.can_edit_org(public.agent_org(agent_id), auth.uid()));
CREATE POLICY "Editors delete flows" ON public.flows
FOR DELETE TO authenticated USING (public.can_edit_org(public.agent_org(agent_id), auth.uid()));

-- Flow versions
CREATE TABLE public.flow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  json jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES auth.users(id),
  UNIQUE(flow_id, version_number)
);
CREATE INDEX idx_flow_versions_flow ON public.flow_versions(flow_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_versions TO authenticated;
GRANT ALL ON public.flow_versions TO service_role;
ALTER TABLE public.flow_versions ENABLE ROW LEVEL SECURITY;

-- Now add the FK from flows to flow_versions
ALTER TABLE public.flows
  ADD CONSTRAINT flows_published_version_fkey
  FOREIGN KEY (published_version_id) REFERENCES public.flow_versions(id) ON DELETE SET NULL;

CREATE POLICY "Members view versions" ON public.flow_versions
FOR SELECT TO authenticated USING (public.is_org_member(public.flow_org(flow_id), auth.uid()));
CREATE POLICY "Editors create versions" ON public.flow_versions
FOR INSERT TO authenticated WITH CHECK (
  public.can_edit_org(public.flow_org(flow_id), auth.uid())
  AND published_by = auth.uid()
);
-- Versions are immutable: no UPDATE/DELETE policies

-- Updated_at trigger for flows
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_flows_updated_at
BEFORE UPDATE ON public.flows
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

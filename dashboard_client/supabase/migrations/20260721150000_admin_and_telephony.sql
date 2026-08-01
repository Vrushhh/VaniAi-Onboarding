-- Migration: platform admin, organization status management, telephony configuration and phone number assignment
-- File suggestion: supabase/migrations/20260721150000_admin_and_telephony.sql

-- ============================================================
-- 1. Platform Admin Schema & Helper (Step 0)
-- ============================================================

-- Add platform admin flag to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

-- Create is_platform_admin() security definer function
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT is_platform_admin FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, anon;

-- Elevate default tester email to platform admin
UPDATE public.profiles 
SET is_platform_admin = true 
WHERE email = 'ha.prasad0203@gmail.com';

-- ============================================================
-- 2. Organizations Admin policies & status (Feature #18 & #19)
-- ============================================================

-- Add status column to organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended'));

-- Selective admin read policy
DROP POLICY IF EXISTS "Platform admins can view all organizations" ON public.organizations;
CREATE POLICY "Platform admins can view all organizations"
  ON public.organizations FOR SELECT
  USING (public.is_platform_admin());

-- Guarded status update function
CREATE OR REPLACE FUNCTION public.admin_set_org_status(_org_id uuid, _status text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authorized');
  END IF;
  IF _status NOT IN ('active', 'suspended') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid status');
  END IF;
  UPDATE public.organizations SET status = _status WHERE id = _org_id;
  RETURN jsonb_build_object('success', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.admin_set_org_status(uuid, text) TO authenticated;

-- Selective admin delete policy
DROP POLICY IF EXISTS "Platform admins can delete any organization" ON public.organizations;
CREATE POLICY "Platform admins can delete any organization"
  ON public.organizations FOR DELETE
  USING (public.is_platform_admin());

-- ============================================================
-- 3. Telephony Provider Config (Feature #20)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.telephony_config (
  org_id       uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider     text NOT NULL CHECK (provider IN ('exotel', 'plivo')),
  account_sid  text NOT NULL,
  auth_token   text NOT NULL,
  exophone     text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.telephony_config ENABLE ROW LEVEL SECURITY;

-- RPC to write/set telephony config (owners only)
CREATE OR REPLACE FUNCTION public.set_telephony_config(
  _org_id uuid, _provider text, _account_sid text, _auth_token text, _exophone text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_org_owner(_org_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Only owners can set telephony config');
  END IF;
  INSERT INTO public.telephony_config (org_id, provider, account_sid, auth_token, exophone, updated_at)
  VALUES (_org_id, _provider, _account_sid, _auth_token, _exophone, now())
  ON CONFLICT (org_id) DO UPDATE SET
    provider = EXCLUDED.provider, account_sid = EXCLUDED.account_sid,
    auth_token = EXCLUDED.auth_token, exophone = EXCLUDED.exophone, updated_at = now();
  RETURN jsonb_build_object('success', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.set_telephony_config(uuid, text, text, text, text) TO authenticated;

-- RPC to read masked telephony config (members only)
CREATE OR REPLACE FUNCTION public.get_telephony_config(_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cfg record;
BEGIN
  IF NOT public.is_org_member(_org_id) THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  SELECT * INTO cfg FROM public.telephony_config WHERE org_id = _org_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  RETURN jsonb_build_object(
    'found', true, 'provider', cfg.provider, 'account_sid', cfg.account_sid,
    'exophone', cfg.exophone,
    'auth_token_masked', repeat('•', 8) || right(cfg.auth_token, 4),
    'updated_at', cfg.updated_at
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.get_telephony_config(uuid) TO authenticated;

-- ============================================================
-- 4. Phone Number Assignment (Feature #17)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.phone_numbers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  phone_number  text NOT NULL,
  provider      text NOT NULL CHECK (provider IN ('exotel', 'plivo')),
  assigned_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, phone_number)
);

ALTER TABLE public.phone_numbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view phone numbers" ON public.phone_numbers;
CREATE POLICY "Org members can view phone numbers"
  ON public.phone_numbers FOR SELECT
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Editors and owners can manage phone numbers" ON public.phone_numbers;
CREATE POLICY "Editors and owners can manage phone numbers"
  ON public.phone_numbers FOR ALL
  USING (public.is_org_owner(org_id) OR EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = phone_numbers.org_id AND user_id = auth.uid() AND role IN ('owner','editor')
  ))
  WITH CHECK (public.is_org_owner(org_id) OR EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = phone_numbers.org_id AND user_id = auth.uid() AND role IN ('owner','editor')
  ));

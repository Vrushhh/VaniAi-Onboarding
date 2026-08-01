-- Migration: org_invites table + accept_org_invite RPC
-- File suggestion: supabase/migrations/20260719231500_org_invites.sql

CREATE TABLE IF NOT EXISTS public.org_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  invited_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Enable RLS on org_invites
ALTER TABLE public.org_invites ENABLE ROW LEVEL SECURITY;

-- Policies for org_invites
-- 1. Owners can view invites in their organization
CREATE POLICY "Owners can view invites" ON public.org_invites
  FOR SELECT USING (
    public.is_org_member(org_id) AND (public.is_org_owner(org_id) OR public.is_platform_admin())
  );

-- 2. Owners can create invites in their organization
CREATE POLICY "Owners can create invites" ON public.org_invites
  FOR INSERT WITH CHECK (
    public.is_org_member(org_id) AND (public.is_org_owner(org_id) OR public.is_platform_admin())
  );

-- 3. Owners can update invites (e.g. revoke) in their organization
CREATE POLICY "Owners can update invites" ON public.org_invites
  FOR UPDATE USING (
    public.is_org_member(org_id) AND (public.is_org_owner(org_id) OR public.is_platform_admin())
  );

-- 4. Anyone can view an invite by its token (required for the accept page to check details without logging in first)
CREATE POLICY "Anyone can view invite by token" ON public.org_invites
  FOR SELECT USING (true);

-- SECURITY DEFINER RPC to accept an invite
CREATE OR REPLACE FUNCTION public.accept_org_invite(invite_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite RECORD;
  v_user_email TEXT;
BEGIN
  -- Get the current authenticated user's email
  v_user_email := (auth.jwt() ->> 'email');
  
  IF v_user_email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  -- Load the invite
  SELECT * INTO v_invite
  FROM public.org_invites
  WHERE token = invite_token AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invite not found or already processed');
  END IF;

  -- Verify email matches (case-insensitive)
  IF LOWER(v_invite.email) != LOWER(v_user_email) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invite email does not match logged-in user email');
  END IF;

  -- Insert user into org_members
  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (v_invite.org_id, auth.uid(), v_invite.role::public.org_role)
  ON CONFLICT (org_id, user_id) DO UPDATE
  SET role = EXCLUDED.role;

  -- Update invite status
  UPDATE public.org_invites
  SET status = 'accepted'
  WHERE id = v_invite.id;

  RETURN jsonb_build_object('success', true, 'org_id', v_invite.org_id);
END;
$$;

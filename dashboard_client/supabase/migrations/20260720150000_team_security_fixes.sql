-- Migration: team security fixes, invite expiration & last owner check trigger
-- File suggestion: supabase/migrations/20260720150000_team_security_fixes.sql

-- 1. Alter table public.org_invites to add expires_at
ALTER TABLE public.org_invites 
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + INTERVAL '7 days');

-- 2. Drop the world-readable SELECT policy
DROP POLICY IF EXISTS "Anyone can view invite by token" ON public.org_invites;

-- 3. Create get_invite_preview SECURITY DEFINER RPC
CREATE OR REPLACE FUNCTION public.get_invite_preview(invite_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv record;
  org_name text;
BEGIN
  SELECT * INTO inv FROM public.org_invites WHERE token = invite_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'status', 'not_found');
  END IF;

  IF inv.status <> 'pending' THEN
    RETURN jsonb_build_object('found', true, 'status', inv.status);
  END IF;

  IF inv.expires_at IS NOT NULL AND inv.expires_at <= now() THEN
    RETURN jsonb_build_object('found', true, 'status', 'expired');
  END IF;

  SELECT name INTO org_name FROM public.organizations WHERE id = inv.org_id;
  RETURN jsonb_build_object(
    'found', true,
    'status', 'pending',
    'org_name', org_name,
    'email', inv.email,
    'role', inv.role,
    'expires_at', inv.expires_at
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.get_invite_preview(uuid) TO authenticated, anon;

-- 4. Update public.accept_org_invite to check expiration
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

  -- Check if expired
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'message', 'This invite has expired');
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

-- 5. Trigger to prevent last owner deletion/demotion
CREATE OR REPLACE FUNCTION public.prevent_last_owner_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_count int;
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.role = 'owner')
     OR (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role <> 'owner') THEN
    SELECT count(*) INTO owner_count FROM public.org_members
      WHERE org_id = OLD.org_id AND role = 'owner';
    IF owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove or demote the last owner of the organization';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_prevent_last_owner ON public.org_members;
CREATE TRIGGER trg_prevent_last_owner
  BEFORE UPDATE OR DELETE ON public.org_members
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_owner_change();

-- Migration: org_members RLS policies + co-member profile visibility
-- Fixes: members list returning 0 rows (RLS read block), and other members'
-- names/emails coming back null (profiles embed blocked by RLS).
-- File suggestion: supabase/migrations/20260719230000_org_members_rls_policies.sql

-- ============================================================
-- 0. Defensive: ensure the org_members -> profiles FK exists.
-- (The earlier migration's ADD CONSTRAINT can fail on pre-existing
--  rows; if it did, the profiles() embed in the members query breaks.)
-- Backfill any missing profile rows first, then add the FK if absent.
-- ============================================================
INSERT INTO public.profiles (id, email)
SELECT u.id, u.email
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.org_members'::regclass
      AND contype = 'f'
      AND conname = 'org_members_user_id_profiles_fkey'
  ) THEN
    ALTER TABLE public.org_members
      ADD CONSTRAINT org_members_user_id_profiles_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- 1. SECURITY DEFINER helpers (bypass RLS -> no recursion)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_org_member(_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = _org_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner(_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = _org_id AND user_id = auth.uid() AND role = 'owner'
  );
$$;

-- True if the caller shares at least one org with _target_user.
-- Used to let members see each other's profile (name/email) in the list.
CREATE OR REPLACE FUNCTION public.shares_org_with(_target_user uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_members me
    JOIN public.org_members them ON them.org_id = me.org_id
    WHERE me.user_id = auth.uid()
      AND them.user_id = _target_user
  );
$$;

-- ============================================================
-- 2. org_members policies
-- ============================================================
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

-- Drop our own policy names if a prior run created them (idempotent).
DROP POLICY IF EXISTS "Members can view membership of their orgs" ON public.org_members;
DROP POLICY IF EXISTS "Owners can add members" ON public.org_members;
DROP POLICY IF EXISTS "Owners can update member roles" ON public.org_members;
DROP POLICY IF EXISTS "Owners can remove members or self can leave" ON public.org_members;

-- READ: any member of an org can see all membership rows of that org.
-- Platform admins can see everything.
CREATE POLICY "Members can view membership of their orgs"
ON public.org_members FOR SELECT
USING (
  public.is_org_member(org_id) OR public.is_platform_admin()
);

-- INSERT: owners can add members directly.
-- (Org creation and invite acceptance go through SECURITY DEFINER RPCs
--  which bypass RLS, so this only governs direct owner-side inserts.)
CREATE POLICY "Owners can add members"
ON public.org_members FOR INSERT
WITH CHECK (
  public.is_org_owner(org_id) OR public.is_platform_admin()
);

-- UPDATE: only owners can change roles.
CREATE POLICY "Owners can update member roles"
ON public.org_members FOR UPDATE
USING (public.is_org_owner(org_id) OR public.is_platform_admin())
WITH CHECK (public.is_org_owner(org_id) OR public.is_platform_admin());

-- DELETE: owners can remove anyone; any member can remove themselves (leave).
CREATE POLICY "Owners can remove members or self can leave"
ON public.org_members FOR DELETE
USING (
  public.is_org_owner(org_id)
  OR user_id = auth.uid()
  OR public.is_platform_admin()
);

-- ============================================================
-- 3. profiles: additive SELECT so co-members can see each other.
-- Existing "read own profile" policy stays; this is OR-ed with it.
-- ============================================================
DROP POLICY IF EXISTS "Members can view co-member profiles" ON public.profiles;

CREATE POLICY "Members can view co-member profiles"
ON public.profiles FOR SELECT
USING (
  id = auth.uid()
  OR public.shares_org_with(id)
  OR public.is_platform_admin()
);

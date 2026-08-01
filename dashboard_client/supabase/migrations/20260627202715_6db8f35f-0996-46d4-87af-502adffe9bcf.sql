
DROP TRIGGER IF EXISTS trg_org_creator_owner ON public.organizations;
DROP TRIGGER IF EXISTS add_creator_as_owner_trigger ON public.organizations;
DROP FUNCTION IF EXISTS public.add_creator_as_owner() CASCADE;

CREATE OR REPLACE FUNCTION public.create_organization(_name text)
RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org public.organizations;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  INSERT INTO public.organizations (name) VALUES (_name) RETURNING * INTO _org;
  INSERT INTO public.org_members (org_id, user_id, role) VALUES (_org.id, auth.uid(), 'owner');
  RETURN _org;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization(text) TO authenticated;

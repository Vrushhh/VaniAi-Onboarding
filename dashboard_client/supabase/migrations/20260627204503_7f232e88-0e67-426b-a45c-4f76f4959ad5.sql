DROP POLICY IF EXISTS "Authenticated users can create orgs" ON public.organizations;
REVOKE INSERT ON public.organizations FROM authenticated;
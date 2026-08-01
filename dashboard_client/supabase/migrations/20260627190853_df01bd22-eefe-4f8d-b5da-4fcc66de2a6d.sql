
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.org_role_of(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_edit_org(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_org_owner(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.flow_org(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.agent_org(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_creator_as_owner() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_role_of(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_org(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.flow_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_org(uuid) TO authenticated;

DROP POLICY IF EXISTS "Any authed user can create an org" ON public.organizations;
CREATE POLICY "Any authed user can create an org" ON public.organizations
FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

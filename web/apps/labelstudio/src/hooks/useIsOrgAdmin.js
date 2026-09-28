import { useAuth } from "@humansignal/core/providers/AuthProvider";

/**
 * Project access control: organization admins see every project, create projects and manage
 * who can open them. When the server doesn't report the flag (older backend), behave as before.
 *
 * @returns {{ isOrgAdmin: boolean, accessControl: boolean, isLoading: boolean }}
 */
export const useIsOrgAdmin = () => {
  const { user, isLoading } = useAuth();

  return {
    isOrgAdmin: user?.is_org_admin ?? true,
    accessControl: user?.project_access_control ?? false,
    isLoading,
  };
};

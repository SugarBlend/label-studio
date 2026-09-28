import type { Ability } from "../providers/AuthProvider";

export type APIUser = {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  last_activity: string;
  avatar: string | null;
  initials: string;
  phone: string;
  active_organization: number;
  active_organization_meta: {
    title: string;
    email: string;
  };
  allow_newsletters: boolean;
  date_joined: string;
  permissions?: Ability[];
  /** Admin of the active organization: sees all projects, creates projects, manages project access */
  is_org_admin?: boolean;
  /** Whether project access control is enabled on the server */
  project_access_control?: boolean;
};

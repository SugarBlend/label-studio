import { format } from "date-fns";
import { NavLink } from "react-router-dom";
import { IconCross } from "@humansignal/icons";
import { useState } from "react";
import { Userpic, Button, Toggle, useToast } from "@humansignal/ui";
import { useAuth } from "@humansignal/core/providers/AuthProvider";
import { useIsOrgAdmin } from "../../../hooks/useIsOrgAdmin";
import { useAPI } from "../../../providers/ApiProvider";
import { cn } from "../../../utils/bem";
import "./SelectedUser.scss";

const UserProjectsLinks = ({ projects }) => {
  return (
    <div className={cn("user-info").elem("links-list").toClassName()}>
      {projects.map((project) => (
        <NavLink
          className={cn("user-info").elem("project-link").toClassName()}
          key={`project-${project.id}`}
          to={`/projects/${project.id}`}
          data-external
        >
          {project.title}
        </NavLink>
      ))}
    </div>
  );
};

/**
 * Project access control: organization admins see all projects, create projects and manage project access.
 * Admins can make other members admins; the owner is always an admin.
 */
const AdminRole = ({ user, onChange }) => {
  const api = useAPI();
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const { isOrgAdmin, accessControl } = useIsOrgAdmin();
  const [saving, setSaving] = useState(false);

  if (!accessControl) return null;

  const toggle = async (e) => {
    const isAdmin = e.target.checked;
    setSaving(true);
    const result = await api.callApi("updateMembership", {
      params: { pk: currentUser.active_organization, userPk: user.id },
      body: { is_admin: isAdmin },
    });
    setSaving(false);

    if (result && !result.error) {
      toast.show({ message: isAdmin ? "Member is now an organization admin" : "Admin rights revoked" });
      onChange?.({ ...user, is_admin: isAdmin });
    }
  };

  return (
    <div className={cn("user-info").elem("section").toClassName()}>
      <div className={cn("user-info").elem("section-title").toClassName()}>Role</div>
      <Toggle
        checked={!!user.is_admin}
        disabled={!isOrgAdmin || user.is_owner || saving}
        onChange={toggle}
        label="Organization admin"
        description={
          user.is_owner
            ? "The organization owner is always an admin"
            : "Sees all projects, creates projects and manages who can open them"
        }
      />
    </div>
  );
};

export const SelectedUser = ({ user, onClose, onChange }) => {
  const fullName = [user.first_name, user.last_name]
    .filter((n) => !!n)
    .join(" ")
    .trim();

  return (
    <div className={cn("user-info").toClassName()}>
      <Button
        look="string"
        onClick={onClose}
        className="absolute top-[20px] right-[24px]"
        aria-label="Close user details"
      >
        <IconCross />
      </Button>

      <div className={cn("user-info").elem("header").toClassName()}>
        <Userpic user={user} style={{ width: 64, height: 64, fontSize: 28 }} />
        <div className={cn("user-info").elem("info-wrapper").toClassName()}>
          {fullName && <div className={cn("user-info").elem("full-name").toClassName()}>{fullName}</div>}
          <p className={cn("user-info").elem("email").toClassName()}>{user.email}</p>
        </div>
      </div>

      <AdminRole user={user} onChange={onChange} />

      {user.phone && (
        <div className={cn("user-info").elem("section").toClassName()}>
          <a href={`tel:${user.phone}`}>{user.phone}</a>
        </div>
      )}

      {!!user.created_projects.length && (
        <div className={cn("user-info").elem("section").toClassName()}>
          <div className={cn("user-info").elem("section-title").toClassName()}>Created Projects</div>

          <UserProjectsLinks projects={user.created_projects} />
        </div>
      )}

      {!!user.contributed_to_projects.length && (
        <div className={cn("user-info").elem("section").toClassName()}>
          <div className={cn("user-info").elem("section-title").toClassName()}>Contributed to</div>

          <UserProjectsLinks projects={user.contributed_to_projects} />
        </div>
      )}

      <p className={cn("user-info").elem("last-active").toClassName()}>
        Last activity on: {format(new Date(user.last_activity), "dd MMM yyyy, KK:mm a")}
      </p>
    </div>
  );
};

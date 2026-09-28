import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Toggle, Typography, Userpic, useToast } from "@humansignal/ui";
import { createTitleFromSegments, useUpdatePageTitle } from "@humansignal/core";
import Input from "../../components/Form/Elements/Input/Input";
import { Spinner } from "../../components/Spinner/Spinner";
import { useIsOrgAdmin } from "../../hooks/useIsOrgAdmin";
import { useAPI } from "../../providers/ApiProvider";
import { useProject } from "../../providers/ProjectProvider";
import "./AccessSettings.scss";

const userName = (user) => {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return name || user.username || user.email;
};

/**
 * Project access control: organization admins choose which members can open this project.
 * Admins always have access and are listed as such.
 */
export const AccessSettings = () => {
  const { project } = useProject();
  const { isOrgAdmin } = useIsOrgAdmin();
  const api = useAPI();
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(() => new Set());

  useUpdatePageTitle(createTitleFromSegments([project?.title, "Access"]));

  const load = useCallback(async () => {
    if (!project?.id || !isOrgAdmin) return;
    const result = await api.callApi("projectAccess", { params: { pk: project.id } });
    if (result?.users) setUsers(result.users);
  }, [api, project?.id, isOrgAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const setAccess = useCallback(
    async (user, hasAccess) => {
      setSaving((prev) => new Set(prev).add(user.id));
      // optimistic update, reverted by the server response on failure
      setUsers((prev) => prev?.map((u) => (u.id === user.id ? { ...u, has_access: hasAccess } : u)));

      const result = await api.callApi("updateProjectAccess", {
        params: { pk: project.id },
        body: { user_ids: [user.id], has_access: hasAccess },
      });

      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(user.id);
        return next;
      });

      if (result?.users) {
        setUsers(result.users);
        toast.show({
          message: hasAccess
            ? `${userName(user)} can now open this project`
            : `${userName(user)} no longer has access to this project`,
        });
      } else {
        load();
      }
    },
    [api, project?.id, load, toast],
  );

  const filtered = useMemo(() => {
    if (!users) return [];
    const query = search.trim().toLowerCase();
    if (!query) return users;
    return users.filter((u) =>
      [u.email, u.first_name, u.last_name, u.username].some((v) => v?.toLowerCase().includes(query)),
    );
  }, [users, search]);

  const grantedCount = users?.filter((u) => u.has_access).length ?? 0;

  if (!isOrgAdmin) {
    return (
      <div className="project-access">
        <h1>Access</h1>
        <Typography size="small" className="project-access__description">
          Only organization admins can manage project access.
        </Typography>
      </div>
    );
  }

  return (
    <div className="project-access">
      <h1>Access</h1>
      <Typography size="small" className="project-access__description">
        Only organization admins and the members selected below can see and open this project. Admins always have access
        to every project.
      </Typography>

      {users === null ? (
        <div className="project-access__loading">
          <Spinner size={32} />
        </div>
      ) : (
        <>
          <div className="project-access__toolbar">
            <Input
              placeholder="Search members"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="project-access__search"
            />
            <Typography size="small" className="project-access__counter">
              {grantedCount} of {users.length} members have access
            </Typography>
          </div>

          <div className="project-access__list" data-testid="project-access-list">
            {filtered.map((user) => (
              <div key={user.id} className="project-access__row">
                <Userpic user={user} size={32} />
                <div className="project-access__user">
                  <div className="project-access__name">
                    {userName(user)}
                    {user.is_admin && (
                      <Badge variant="info" className="project-access__badge">
                        Admin
                      </Badge>
                    )}
                  </div>
                  {userName(user) !== user.email && <div className="project-access__email">{user.email}</div>}
                </div>
                <Toggle
                  checked={user.has_access}
                  disabled={user.is_admin || saving.has(user.id)}
                  onChange={(e) => setAccess(user, e.target.checked)}
                  aria-label={`Access for ${user.email}`}
                  title={user.is_admin ? "Admins always have access" : undefined}
                />
              </div>
            ))}
            {filtered.length === 0 && (
              <Typography size="small" className="project-access__empty">
                No members match your search
              </Typography>
            )}
          </div>
        </>
      )}
    </div>
  );
};

AccessSettings.title = "Access";
AccessSettings.path = "/access";

/** Settings page wrapper that renders only for organization admins */
export const useAccessSettingsMenuItem = () => {
  const { isOrgAdmin, accessControl } = useIsOrgAdmin();
  return accessControl && isOrgAdmin ? AccessSettings : null;
};

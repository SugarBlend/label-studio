import { useCallback, useEffect, useMemo, useState } from "react";
import { Toggle, Userpic, useToast } from "@humansignal/ui";
import { createTitleFromSegments, useUpdatePageTitle } from "@humansignal/core";
import { useIsOrgAdmin } from "../../hooks/useIsOrgAdmin";
import { useAPI } from "../../providers/ApiProvider";
import { useProject } from "../../providers/ProjectProvider";
import { cn } from "../../utils/bem";
import "./AccessSettings.scss";

const cls = (element) => cn("project-access", element ? { elem: element } : {}).toClassName();
const userName = (user) => [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || user.email;
const roleName = (user) => user.is_owner ? "Owner" : user.is_admin ? "Admin" : "Member";

export const AccessSettings = () => {
  const { project } = useProject();
  const { canManageProjectSettings, isLoading } = useIsOrgAdmin();
  const api = useAPI();
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [saving, setSaving] = useState(() => new Set());
  const [error, setError] = useState("");

  useUpdatePageTitle(createTitleFromSegments([project?.title, "Access"]));

  const load = useCallback(async () => {
    if (!project?.id || !canManageProjectSettings) return;
    setError("");
    const result = await api.callApi("projectAccess", { params: { pk: project.id } });
    if (Array.isArray(result?.users)) setUsers(result.users);
    else setError("Could not load members. Refresh the page to try again.");
  }, [api, project?.id, canManageProjectSettings]);

  useEffect(() => {
    setUsers(null);
    if (canManageProjectSettings) load();
  }, [load, canManageProjectSettings]);

  const setAccess = useCallback(async (user, hasAccess) => {
    if (user.is_admin || saving.has(user.id)) return;
    setError("");
    setSaving((prev) => new Set(prev).add(user.id));
    setUsers((prev) => prev?.map((member) =>
      member.id === user.id ? { ...member, has_access: hasAccess } : member));
    try {
      const response = await api.callApi("updateProjectAccess", {
        params: { pk: project.id },
        body: { user_ids: [user.id], has_access: hasAccess },
      });
      if (!Array.isArray(response?.users)) throw new Error("Unable to update access.");
      setUsers(response.users);
      toast.show({ message: hasAccess ? `Access granted to ${userName(user)}` : `Access revoked for ${userName(user)}` });
    } catch (err) {
      setError(err.message || "Unable to update access.");
      await load();
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(user.id);
        return next;
      });
    }
  }, [api, load, project?.id, saving, toast]);

  const administrators = useMemo(() =>
    (users ?? []).filter((user) => user.is_admin).sort((a, b) =>
      Number(Boolean(b.is_owner)) - Number(Boolean(a.is_owner)) || userName(a).localeCompare(userName(b))),
  [users]);
  const members = useMemo(() => (users ?? []).filter((user) => !user.is_admin), [users]);
  const grantedCount = members.filter((user) => user.has_access).length;
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [...members, ...administrators].filter((user) => {
      const matchQuery = !query || [userName(user), user.email, roleName(user)]
        .some((value) => String(value || "").toLocaleLowerCase().includes(query));
      const matchFilter = filter === "all" || (filter === "granted" && user.has_access) ||
        (filter === "denied" && !user.has_access) || (filter === "admins" && user.is_admin);
      return matchQuery && matchFilter;
    });
  }, [search, filter, members, administrators]);
  const visibleAdmins = filtered.filter((user) => user.is_admin);
  const visibleMembers = filtered.filter((user) => !user.is_admin);

  const row = (user) => (
    <div className={cls("row")} key={user.id}>
      <Userpic user={user} size={36} />
      <div className={cls("identity")}>
        <div className={cls("name-line")}>
          <strong>{userName(user)}</strong>
          {user.is_admin && <span className={cls(user.is_owner ? "badge-owner" : "badge-admin")}>{roleName(user)}</span>}
        </div>
        {userName(user) !== user.email && <div className={cls("email")}>{user.email}</div>}
      </div>
      <div className={cls("permission")}>
        <span className={cls(user.has_access ? "state-granted" : "state-denied")}>
          {user.has_access ? "Has access" : "No access"}
        </span>
        <Toggle checked={user.has_access} disabled={user.is_admin || saving.has(user.id)}
          onChange={(event) => setAccess(user, event.target.checked)}
          aria-label={`Project access for ${user.email}`}
          title={user.is_admin ? "Owner and admins always have access" : undefined} />
      </div>
    </div>
  );

  if (isLoading) return <div className={cls("loading")}>Checking permissions…</div>;
  if (!canManageProjectSettings) return (
    <div className={cls()}>
      <h1>Access restricted</h1>
      <p className={cls("description")}>Only the organization owner and admins may manage project settings.</p>
    </div>
  );

  return (
    <div className={cls()}>
      <header className={cls("header")}>
        <div className={cls("eyebrow")}>PROJECT SETTINGS / PERMISSIONS</div>
        <h1>Project access</h1>
        <p className={cls("description")}>
          Control which organization members can open and annotate this project.
          The organization owner and admins always have access.
        </p>
      </header>

      {users === null ? (
        <div className={cls("loading")}>{error || "Loading organization members…"}</div>
      ) : (
        <>
          <div className={cls("summary")}>
            <div className={cls("stat")}>
              <span className={cls("stat-number")}>{members.length}</span>
              <span>Organization members</span>
            </div>
            <div className={cls("stat")}>
              <span className={cls("stat-number")}>{grantedCount}</span>
              <span>Members with access</span>
            </div>
            <div className={cls("stat")}>
              <span className={cls("stat-number")}>{administrators.length}</span>
              <span>Owner & admins</span>
            </div>
          </div>

          <div className={cls("panel")}>
            <div className={cls("toolbar")}>
              <label className={cls("search-label")}>
                <span className={cls("sr-only")}>Search members</span>
                <input type="search" placeholder="Search by name or email…" value={search}
                  onChange={(event) => setSearch(event.target.value)} />
              </label>
              <div className={cls("filters")} role="group" aria-label="Filter access">
                {[
                  ["all", "All"],
                  ["granted", "With access"],
                  ["denied", "Without access"],
                  ["admins", "Admins"],
                ].map(([value, label]) => (
                  <button key={value} type="button" className={cls(filter === value ? "filter-active" : "filter")}
                    aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
                ))}
              </div>
            </div>
            {visibleAdmins.length > 0 && (
              <section className={cls("group")}>
                <div className={cls("group-heading")}>
                  <h2>Owner & administrators</h2>
                  <span>Permanent access</span>
                </div>
                {visibleAdmins.map(row)}
              </section>
            )}
            {visibleMembers.length > 0 && (
              <section className={cls("group")}>
                <div className={cls("group-heading")}>
                  <h2>Organization members</h2>
                  <span>Manage individually</span>
                </div>
                {visibleMembers.map(row)}
              </section>
            )}
            {filtered.length === 0 && (
              <div className={cls("empty")}>No members match your search or filter.</div>
            )}
          </div>
          <div className={cls("note")}>
            Changes are saved immediately. Removing access prevents a member from opening
            this project, but does not delete their existing annotations.
          </div>
        </>
      )}
      {error && users !== null && <div className={cls("error")} role="alert">{error}</div>}
    </div>
  );
};

AccessSettings.title = "Access";
AccessSettings.path = "/access";

export const useAccessSettingsMenuItem = () => {
  const { canManageProjectSettings, accessControl } = useIsOrgAdmin();
  return accessControl && canManageProjectSettings ? AccessSettings : null;
};

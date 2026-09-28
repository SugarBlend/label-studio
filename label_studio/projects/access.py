"""Project access control.

Rules:
- organization admins see and manage every project of their organization:
  the organization owner, Django superusers and members with `OrganizationMember.is_admin`;
- other members see only projects an admin has opened for them
  (an enabled `ProjectMember` row), and can do everything inside those projects;
- only admins create projects and manage project access.

Can be switched off with PROJECT_ACCESS_CONTROL_ENABLED=false (then every member of the
organization has access to all its projects, as in stock Label Studio).
"""
from typing import Optional

from django.conf import settings
from django.db.models import Q
from rest_framework.exceptions import NotFound, PermissionDenied


def is_access_control_enabled() -> bool:
    return getattr(settings, 'PROJECT_ACCESS_CONTROL_ENABLED', True)


def _organization_id(user, organization) -> Optional[int]:
    if organization is not None:
        return organization if isinstance(organization, int) else organization.id
    return getattr(user, 'active_organization_id', None)


def is_org_admin(user, organization=None) -> bool:
    """True if the user is an admin of the organization (the active one by default)"""
    from organizations.models import Organization, OrganizationMember

    if user is None or not getattr(user, 'is_authenticated', False):
        return False
    if getattr(user, 'is_superuser', False):
        return True

    org_id = _organization_id(user, organization)
    if org_id is None:
        return False

    if Organization.objects.filter(id=org_id, created_by_id=user.id).exists():
        return True

    return OrganizationMember.objects.filter(
        user_id=user.id, organization_id=org_id, deleted_at__isnull=True, is_admin=True
    ).exists()


def has_project_access(user, project) -> bool:
    """True if the user may open the project (admins: always; others: when access is granted)"""
    from projects.models import ProjectMember

    if not is_access_control_enabled():
        return True
    if user is None or not getattr(user, 'is_authenticated', False):
        return False
    if project.organization_id is None:
        # legacy projects without an organization have no admins to grant access: keep them open
        return True
    if is_org_admin(user, project.organization_id):
        return True
    return ProjectMember.objects.filter(user_id=user.id, project_id=project.id, enabled=True).exists()


def accessible_projects_q(user, project_field: str = 'id') -> Q:
    """Filter for querysets: rows whose project the user may open.

    :param project_field: path to the project id, e.g. 'id' for Project, 'project_id' for Task
    """
    from projects.models import ProjectMember

    if not is_access_control_enabled() or is_org_admin(user):
        return Q()
    if user is None or not getattr(user, 'is_authenticated', False):
        return Q(pk__in=[])

    granted = ProjectMember.objects.filter(user_id=user.id, enabled=True).values('project_id')
    return Q(**{f'{project_field}__in': granted})


def ensure_project_access(user, project) -> None:
    """Raise 404 for a project the user may not open (don't reveal that it exists)"""
    if project is None or not project.has_permission(user):
        raise NotFound('Project not found')


def ensure_org_admin(user, organization=None, message='Only organization admins can do this') -> None:
    if is_access_control_enabled() and not is_org_admin(user, organization):
        raise PermissionDenied(message)

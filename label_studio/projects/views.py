"""This file and its contents are licensed under the Apache License 2.0. Please see the included NOTICE for copyright information and LICENSE for a copy of the license.
"""
import logging

from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, render
from django.core.exceptions import PermissionDenied
from projects.access import is_org_admin
from projects.models import Project

logger = logging.getLogger(__name__)


@login_required
def project_list(request):
    return render(request, 'projects/list.html')


@login_required
def project_settings(request, pk, sub_path):
    # Reject direct navigation to /projects/<id>/settings/* before serving the SPA shell.
    # This check remains active when PROJECT_ACCESS_CONTROL_ENABLED=False.
    project = get_object_or_404(Project, pk=pk, organization=request.user.active_organization)
    if not is_org_admin(request.user, project.organization):
        raise PermissionDenied('Only the organization owner or admins can open project settings')
    return render(request, 'projects/settings.html')

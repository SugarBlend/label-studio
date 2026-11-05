"""Django integration coverage; run with the repository's normal pytest environment."""
import json
from copy import deepcopy

import pytest
from organizations.models import Organization
from projects.models import Project, ProjectMember

from .test_project_access import _grant, setup  # noqa: F401 (shared access-control fixture)

pytestmark = pytest.mark.django_db


def config():
    return {'enabled': True, 'floor_up': [0, 0, 1], 'cameras': [
        {'slot': slot, 'image_width': 1000, 'image_height': 1000,
         'calibration': {'K': [[500, 0, 500], [0, 500, 500], [0, 0, 1]],
                         'R': [[1, 0, 0], [0, 1, 0], [0, 0, 1]], 't': [-x, 0, 0]}}
        for slot, x in enumerate([-1, 1, -2, 2])]}


def post(client, project, body):
    return client.post(f'/api/projects/{project.id}/skeleton-3d/reconstruct/',
                       data=json.dumps(body), content_type='application/json')


def enable(project):
    project.skeleton_3d_config = config()
    project.save(update_fields=['skeleton_3d_config'])


def test_scoped_reconstruction_and_sequence(setup, client):
    admin, member, project, task = setup
    enable(project)
    body = {'observations': [{'slot': 0, 'joint': 'nose', 'x': 600, 'y': 500},
                             {'slot': 1, 'joint': 'nose', 'x': 400, 'y': 500}], 'sequence': 42}
    assert post(client, project, body).status_code in (401, 403)
    assert post(member, project, body).status_code in (403, 404)
    _grant(admin, project, member.user)
    response = post(member, project, body)
    assert response.status_code == 200, response.content
    result = response.json()
    assert result['sequence'] == 42
    assert result['joints'][0]['position'] == pytest.approx([0, 0, 5])
    assert result['foot_tilt'] == {'left': None, 'right': None}
    assert result['warnings'] == []
    assert result['rejected'] == []
    assert result['joints'][0]['views'] == [0, 1]
    task.refresh_from_db()
    assert task.annotations.count() == 0
    _grant(admin, project, member.user, False)
    assert post(member, project, body).status_code in (403, 404)


def test_other_organization_is_hidden_even_with_project_membership(setup):
    admin, member, project, task = setup
    other_org = Organization.objects.create(title='Other organization', created_by=admin.user)
    other = Project.objects.create(title='Other', organization=other_org, created_by=admin.user,
                                   skeleton_3d_config=config())
    ProjectMember.objects.create(project=other, user=member.user, enabled=True)
    for caller in (admin, member):
        assert post(caller, other, {'observations': []}).status_code in (403, 404)


@pytest.mark.parametrize('body', [[], {}, {'observations': [], 'sequence': True},
                                      {'observations': [], 'sequence': -1},
                                      {'observations': [], 'sequence': 9007199254740992},
                                      {'observations': [], 'url': 'http://example.com'},
                                      {'observations': [{'slot': 0, 'joint': 'nose', 'x': -1, 'y': 0}]}])
def test_invalid_requests(setup, body):
    admin, member, project, task = setup
    enable(project)
    assert post(admin, project, body).status_code == 400


def test_disabled_project_and_method_restriction(setup):
    admin, member, project, task = setup
    assert post(admin, project, {'observations': []}).status_code == 400
    assert admin.get(f'/api/projects/{project.id}/skeleton-3d/reconstruct/').status_code == 405


def test_config_serializer_roundtrip_and_validation(setup):
    admin, member, project, task = setup
    url = f'/api/projects/{project.id}/'
    response = admin.patch(url, data=json.dumps({'skeleton_3d_config': config()}), content_type='application/json')
    assert response.status_code == 200, response.content
    assert response.json()['skeleton_3d_config'] == config()
    project.refresh_from_db()
    assert project.skeleton_3d_config == config()
    invalid = deepcopy(config())
    invalid['cameras'][0]['slot'] = 1
    response = admin.patch(url, data=json.dumps({'skeleton_3d_config': invalid}), content_type='application/json')
    assert response.status_code == 400
    project.refresh_from_db()
    assert project.skeleton_3d_config == config()

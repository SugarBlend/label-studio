"""Project access control: only organization admins and users granted access can open a project."""
import json
from copy import deepcopy

import pytest
from django.test import override_settings
from projects.models import Project, ProjectMember
from tasks.models import Task
from users.models import User
from webhooks.models import Webhook

from .utils import signin

LABEL_CONFIG = """
    <View>
      <Text name="text" value="$text"/>
      <Choices name="label" toName="text">
        <Choice value="A"/>
        <Choice value="B"/>
      </Choices>
    </View>"""

DENIED = (403, 404)


def _member_client(client, organization, email):
    """A regular (non-admin) member of the organization, logged in"""
    client = deepcopy(client)
    user = User.objects.create(email=email)
    user.set_password('pytest')
    user.active_organization = organization
    user.save()
    organization.add_user(user)
    assert signin(client, email, 'pytest').status_code == 302
    client.user = user
    return client


@pytest.fixture
def setup(business_client, client):
    owner = business_client.user
    org = business_client.organization
    project = Project.objects.create(
        title='Secret', label_config=LABEL_CONFIG, created_by=owner, organization=org, is_published=True
    )
    task = Task.objects.create(project=project, data={'text': 'hello'})
    member = _member_client(client, org, 'member@access.test')
    return business_client, member, project, task


def _grant(admin, project, user, has_access=True):
    r = admin.post(
        f'/api/projects/{project.id}/access/',
        data=json.dumps({'user_ids': [user.id], 'has_access': has_access}),
        content_type='application/json',
    )
    assert r.status_code == 200, r.content
    return r.json()


def _project_ids(client):
    r = client.get('/api/projects/')
    assert r.status_code == 200
    return {p['id'] for p in r.json()['results']}


@pytest.mark.django_db
def test_member_without_access_cannot_open_project(setup):
    admin, member, project, task = setup

    assert project.id in _project_ids(admin)
    assert project.id not in _project_ids(member)

    urls = [
        f'/api/projects/{project.id}/',
        f'/api/projects/{project.id}/next/',
        f'/api/projects/{project.id}/export?exportType=JSON',
        f'/api/projects/{project.id}/export/formats',
        f'/api/tasks/{task.id}/',
        f'/api/tasks/{task.id}/annotations/',
        f'/api/tasks/{task.id}/drafts',
        f'/api/dm/views/?project={project.id}',
        f'/api/dm/project?project={project.id}',
        f'/api/storages/s3/?project={project.id}',
        f'/api/ml/?project={project.id}',
    ]
    for url in urls:
        r = member.get(url)
        if r.status_code == 200:
            # list endpoints filter by project access instead of failing
            data = r.json()
            items = data if isinstance(data, list) else data.get('results', data.get('tasks'))
            assert not items, f'{url} leaked data: {data}'
        else:
            assert r.status_code in DENIED, f'{url} -> {r.status_code}'

    tasks = member.get(f'/api/tasks/?project={project.id}')
    assert tasks.status_code in DENIED or not tasks.json().get('tasks'), tasks.content


@pytest.mark.django_db
def test_member_without_access_cannot_write_into_project(setup):
    admin, member, project, task = setup

    r = member.post(
        '/api/tasks/', data=json.dumps({'project': project.id, 'data': {'text': 'x'}}), content_type='application/json'
    )
    assert r.status_code in DENIED, r.content

    r = member.post(
        '/api/predictions/',
        data=json.dumps({'task': task.id, 'result': [], 'model_version': 'v1'}),
        content_type='application/json',
    )
    assert r.status_code in DENIED, r.content

    r = member.post(
        f'/api/tasks/{task.id}/annotations/',
        data=json.dumps({'result': []}),
        content_type='application/json',
    )
    assert r.status_code in DENIED, r.content

    r = member.post(f'/api/tasks/{task.id}/drafts', data=json.dumps({'result': []}), content_type='application/json')
    assert r.status_code in DENIED, r.content

    r = member.post(
        '/api/dm/views/', data=json.dumps({'project': project.id, 'data': {}}), content_type='application/json'
    )
    assert r.status_code in DENIED, r.content

    r = member.patch(
        f'/api/projects/{project.id}/', data=json.dumps({'title': 'hacked'}), content_type='application/json'
    )
    assert r.status_code in DENIED, r.content

    r = member.delete(f'/api/projects/{project.id}/')
    assert r.status_code in DENIED, r.content
    assert Project.objects.filter(id=project.id).exists()


@pytest.mark.django_db
def test_admin_grants_and_revokes_access(setup):
    admin, member, project, task = setup

    data = _grant(admin, project, member.user)
    row = next(u for u in data['users'] if u['id'] == member.user.id)
    assert row == {**row, 'has_access': True, 'is_admin': False}

    assert project.id in _project_ids(member)
    assert member.get(f'/api/projects/{project.id}/').status_code == 200
    assert member.get(f'/api/tasks/{task.id}/').status_code == 200
    assert member.get(f'/api/projects/{project.id}/next/').status_code == 200
    r = member.post(
        f'/api/tasks/{task.id}/annotations/', data=json.dumps({'result': []}), content_type='application/json'
    )
    assert r.status_code == 201, r.content

    _grant(admin, project, member.user, has_access=False)

    assert project.id not in _project_ids(member)
    assert member.get(f'/api/projects/{project.id}/').status_code in DENIED
    assert member.get(f'/api/tasks/{task.id}/').status_code in DENIED


@pytest.mark.django_db
def test_access_list_marks_admins(setup):
    admin, member, project, task = setup

    users = {u['id']: u for u in admin.get(f'/api/projects/{project.id}/access/').json()['users']}
    assert users[admin.user.id]['is_admin'] is True
    assert users[admin.user.id]['has_access'] is True
    assert users[member.user.id]['is_admin'] is False
    assert users[member.user.id]['has_access'] is False


@pytest.mark.django_db
def test_only_admins_manage_access_and_create_projects(setup):
    admin, member, project, task = setup
    _grant(admin, project, member.user)

    assert member.get(f'/api/projects/{project.id}/access/').status_code == 403
    r = member.post(
        f'/api/projects/{project.id}/access/',
        data=json.dumps({'user_ids': [member.user.id], 'has_access': True}),
        content_type='application/json',
    )
    assert r.status_code == 403

    r = member.post('/api/projects/', data=json.dumps({'title': 'Mine'}), content_type='application/json')
    assert r.status_code == 403, r.content

    r = admin.post('/api/projects/', data=json.dumps({'title': 'Admins'}), content_type='application/json')
    assert r.status_code == 201, r.content

    # like creation, deleting a whole project is for admins only (even with access to it)
    assert member.get(f'/api/projects/{project.id}/').status_code == 200
    r = member.delete(f'/api/projects/{project.id}/')
    assert r.status_code == 403, r.content
    assert Project.objects.filter(id=project.id).exists()

    r = admin.delete(f'/api/projects/{project.id}/')
    assert r.status_code == 204, r.content
    assert not Project.objects.filter(id=project.id).exists()


@pytest.mark.django_db
def test_access_api_rejects_users_outside_organization(setup, client):
    admin, member, project, task = setup
    stranger = User.objects.create(email='stranger@access.test')

    r = admin.post(
        f'/api/projects/{project.id}/access/',
        data=json.dumps({'user_ids': [stranger.id], 'has_access': True}),
        content_type='application/json',
    )
    assert r.status_code == 400
    assert not ProjectMember.objects.filter(user=stranger).exists()


@pytest.mark.django_db
def test_org_admin_flag(setup):
    admin, member, project, task = setup
    org = admin.organization
    url = f'/api/organizations/{org.id}/memberships/{member.user.id}/'

    assert member.get('/api/current-user/whoami').json()['is_org_admin'] is False
    assert admin.get('/api/current-user/whoami').json()['is_org_admin'] is True

    # a regular member can't promote themselves
    r = member.patch(url, data=json.dumps({'is_admin': True}), content_type='application/json')
    assert r.status_code == 403

    r = admin.patch(url, data=json.dumps({'is_admin': True}), content_type='application/json')
    assert r.status_code == 200, r.content
    assert r.json()['is_admin'] is True

    assert member.get('/api/current-user/whoami').json()['is_org_admin'] is True
    assert project.id in _project_ids(member)
    assert member.get(f'/api/projects/{project.id}/access/').status_code == 200

    # the owner is always an admin
    owner_url = f'/api/organizations/{org.id}/memberships/{admin.user.id}/'
    r = member.patch(owner_url, data=json.dumps({'is_admin': False}), content_type='application/json')
    assert r.status_code == 403

    r = admin.patch(url, data=json.dumps({'is_admin': False}), content_type='application/json')
    assert r.status_code == 200
    assert project.id not in _project_ids(member)


@pytest.mark.django_db
def test_org_level_webhooks_hidden_from_members(setup):
    admin, member, project, task = setup
    org = admin.organization
    org_hook = Webhook.objects.create(organization=org, url='https://example.com/org')
    project_hook = Webhook.objects.create(organization=org, project=project, url='https://example.com/project')

    admin_ids = {w['id'] for w in admin.get('/api/webhooks/').json()}
    assert {org_hook.id, project_hook.id} <= admin_ids

    assert member.get('/api/webhooks/').json() == []
    assert member.get(f'/api/webhooks/{org_hook.id}/').status_code in DENIED

    _grant(admin, project, member.user)
    assert {w['id'] for w in member.get('/api/webhooks/').json()} == {project_hook.id}


@pytest.mark.django_db
@override_settings(PROJECT_ACCESS_CONTROL_ENABLED=False)
def test_everything_open_when_access_control_disabled(setup):
    admin, member, project, task = setup

    assert project.id in _project_ids(member)
    assert member.get(f'/api/tasks/{task.id}/').status_code == 200
    assert member.get('/api/current-user/whoami').json()['is_org_admin'] is True

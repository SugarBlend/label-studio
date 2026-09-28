"""Tests for the upcoming tasks hint returned by the next task API (label stream image prefetch)."""
import json
from datetime import timedelta

import pytest
from django.test import override_settings
from django.utils import timezone
from projects.models import Project
from tasks.models import TaskLock

from .utils import make_annotation, make_annotator, make_project, make_task

LABEL_CONFIG = """
    <View>
      <Image name="image" value="$image"/>
      <Choices name="label" toName="image">
        <Choice value="A"/>
        <Choice value="B"/>
      </Choices>
    </View>"""


def _create_project(user, sampling):
    project = make_project(
        dict(title='prefetch hint', is_published=True, label_config=LABEL_CONFIG), user, use_ml_backend=False
    )
    project.sampling = sampling
    project.save()
    return project


def _next(client, project):
    r = client.get(f'/api/projects/{project.id}/next')
    assert r.status_code == 200, r.content
    return json.loads(r.content)


@pytest.mark.django_db
def test_hint_sequence_sampling(business_client):
    project = _create_project(business_client.user, Project.SEQUENCE)
    ids = [make_task({'data': {'image': f'https://example.com/{i}.jpg'}}, project).id for i in range(5)]
    annotator = make_annotator({'email': 'hint_seq@test.com'}, project, True)

    response = _next(annotator, project)
    assert response['id'] == ids[0]
    assert [t['id'] for t in response['prefetch_hint']] == ids[1:4]
    assert response['prefetch_hint'][0]['data'] == {'image': 'https://example.com/1.jpg'}

    # after the first task is solved the hint moves on and matches what is served next
    make_annotation({'result': [], 'completed_by': annotator.annotator}, ids[0])
    response = _next(annotator, project)
    assert response['id'] == ids[1]
    assert [t['id'] for t in response['prefetch_hint']] == ids[2:5]


@pytest.mark.django_db
def test_hint_skips_tasks_locked_by_others(business_client):
    project = _create_project(business_client.user, Project.SEQUENCE)
    ids = [make_task({'data': {'image': f'https://example.com/{i}.jpg'}}, project).id for i in range(4)]
    annotator = make_annotator({'email': 'hint_lock@test.com'}, project, True)
    other = make_annotator({'email': 'hint_lock_other@test.com'}, project)

    TaskLock.objects.create(task_id=ids[1], user=other, expire_at=timezone.now() + timedelta(hours=1))

    response = _next(annotator, project)
    assert response['id'] == ids[0]
    assert [t['id'] for t in response['prefetch_hint']] == [ids[2], ids[3]]


@pytest.mark.django_db
def test_hint_empty_for_random_sampling(business_client):
    project = _create_project(business_client.user, Project.UNIFORM)
    for i in range(3):
        make_task({'data': {'image': f'https://example.com/{i}.jpg'}}, project)
    annotator = make_annotator({'email': 'hint_uniform@test.com'}, project, True)

    assert _next(annotator, project)['prefetch_hint'] == []


@pytest.mark.django_db
@override_settings(NEXT_TASK_PREFETCH_HINT=0)
def test_hint_can_be_disabled(business_client):
    project = _create_project(business_client.user, Project.SEQUENCE)
    for i in range(3):
        make_task({'data': {'image': f'https://example.com/{i}.jpg'}}, project)
    annotator = make_annotator({'email': 'hint_off@test.com'}, project, True)

    assert _next(annotator, project)['prefetch_hint'] == []

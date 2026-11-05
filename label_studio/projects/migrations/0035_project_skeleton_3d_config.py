from django.db import migrations, models
import projects.skeleton_3d


class Migration(migrations.Migration):
    dependencies = [('projects', '0034_project_annotator_evaluation_enabled')]

    operations = [
        migrations.AddField(
            model_name='project',
            name='skeleton_3d_config',
            field=models.JSONField(
                default=projects.skeleton_3d.default_skeleton_3d_config,
                blank=True,
                help_text='Four-camera skeleton reconstruction configuration',
            ),
        ),
    ]

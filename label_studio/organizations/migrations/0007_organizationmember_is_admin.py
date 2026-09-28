from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('organizations', '0006_alter_organizationmember_deleted_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='organizationmember',
            name='is_admin',
            field=models.BooleanField(
                default=False,
                help_text='Organization admin: has access to all projects, creates projects and manages project '
                'access. The organization owner is always an admin.',
                verbose_name='is admin',
            ),
        ),
    ]

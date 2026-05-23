# Content Management (System Settings)

The Content tab shows all uploaded Ansible playbooks, Packer build definitions and help text overrides.

## Playbooks
Uploaded as ZIP archives. Each ZIP must contain `<playbook>.yml` and `meta.yaml` at the root or one level deep.

## Packer definitions
Uploaded as ZIP archives with `.pkr.hcl` and `meta.yaml`.

## Help texts (PROJ-57)
Manage user-uploaded Markdown overrides. Admins with `manage_help` permission can:
- Promote a user's override to a **global override** (visible to all users with no personal override)
- Remove a global override to fall back to the built-in repository text

<!-- p3portal.org -->
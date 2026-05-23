# Users & Rights (System Settings)

Manage portal users, role presets, pools and groups.

## Sub-sections
- **Users** – create local users, assign portal permissions and role presets
- **Role Presets** – define reusable Proxmox permission bundles
- **Pools** – resource quota containers (Plus)
- **Groups** – user teams for bulk permission assignment (Plus)
- **Playbook Permissions** – whitelist which users/groups can run which playbooks

## User types
- **Local** – password managed by the portal
- **Proxmox** – authenticates against Proxmox directly (no portal password)

## Portal permissions
Fine-grained flags like `manage_users`, `manage_nodes` or `view_logs` that grant partial admin access without making a user a full admin.

<!-- p3portal.org -->
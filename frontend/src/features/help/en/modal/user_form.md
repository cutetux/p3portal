# Create / Edit User

The user form lets admins create and configure portal users.

## Auth type
- **Local** – the portal manages the password
- **Proxmox** – user authenticates against Proxmox directly

## Role preset
Assign a Proxmox role preset that grants the user access to specific VM operations.

## Portal permissions
Fine-grained admin flags. Only admins can set these. Common permissions:
- `manage_users` – create/edit other users
- `manage_nodes` – add/edit Proxmox nodes
- `manage_settings` – access portal settings
- `manage_help` – manage help text overrides

## API key limit
Control how many personal API keys this user can create (Plus: unlimited).

<!-- p3portal.org -->
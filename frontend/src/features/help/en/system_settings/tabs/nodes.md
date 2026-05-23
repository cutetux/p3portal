# Nodes (System Settings)

The Nodes tab lists all registered Proxmox nodes and clusters.

## Adding a node
Click **+ Node hinzufügen** and fill in:
- **Display name** – label shown in the portal
- **Proxmox URL** – e.g. `https://pve.example.com:8006`
- **Cluster mode** – enable if this URL is a Proxmox cluster VIP
- **API tokens** – viewer, operator, admin and Packer tokens

## Token requirements
Each token is a Proxmox API token in the format `user@realm!tokenid`. The portal never stores Proxmox passwords.

## Polling interval
Controls how often the portal refreshes the node's VM and resource data (default: 60 s).

<!-- p3portal.org -->
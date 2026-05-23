# Create / Edit Pool

Pools enforce resource quotas on a group of users.

## Pool name
A short, descriptive label (e.g. `team-dev`, `project-alpha`).

## Quotas
Set maximum values for:
- **VMs** – total number of virtual machines
- **vCPUs** – total virtual CPUs across all VMs
- **RAM (GB)** – total RAM
- **Disk (GB)** – total disk space

Leave a quota blank for unlimited.

## Members
Add users and groups to the pool. When a member deploys, the pool's remaining capacity is checked first.

> **Requires** Plus licence.

<!-- p3portal.org -->
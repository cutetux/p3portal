# Groups / Teams

Groups let you assign Proxmox role presets, node access rights and playbook permissions to multiple users at once.

## Creating a group
Go to **System Settings → Users & Rights → Groups** and click **+ Gruppe erstellen**.

## Assigning members
Add local portal users to the group. Proxmox-only users can be added indirectly by adding them to the group on Proxmox.

## Inherited permissions
A user's effective permissions are the union of their direct permissions and all their group permissions.

> **Note:** Core edition: max. 3 groups. Plus: unlimited.

<!-- p3portal.org -->
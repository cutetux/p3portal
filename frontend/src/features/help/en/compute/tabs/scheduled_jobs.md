# Scheduled Jobs on Node (Plus)

Configure time-triggered actions for a specific Proxmox node.

## Job types
- **Ansible Playbook** – run any playbook on a schedule
- **SSH Command** – execute a shell command on a VM or LXC
- **Power Action** – start, stop, reboot or shut down a VM/LXC

## Cron schedule
Use the visual cron picker or enter a custom cron expression. Times are in the portal server's local timezone.

## Approval
If the approval workflow is enabled, a scheduled job that requires approval will be suspended until approved. See [Approval Workflow](help:modal.approval_detail).

> **Requires** Plus licence.

<!-- p3portal.org -->
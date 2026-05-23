# Scheduled Job Form

Create a new time-triggered job.

## Job type
- **Ansible Playbook** – runs a playbook on a cron schedule
- **SSH Command** – executes a shell command via SSH on a VM or LXC
- **Power Action** – start, stop, reboot or shut down a VM/LXC

## Schedule
Use the visual cron picker or enter a cron expression directly. The portal server's local timezone is used.

## Target
Select the Proxmox node and (for SSH/power actions) the specific VM or LXC.

## Approval
If the approval workflow requires approval for this action type, the job will be created in *pending* state and won't run until approved.

<!-- p3portal.org -->
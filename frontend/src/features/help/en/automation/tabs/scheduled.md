# Scheduled Jobs (Plus)

Schedule Ansible playbooks, SSH commands, and VM/LXC power actions to run automatically on a cron schedule.

## Job types
- **Ansible Playbook** – runs any playbook with preset parameters
- **SSH Command** – runs a shell command on a target host via SSH
- **Power Action** – starts, stops, or reboots a VM or LXC container

## Cron schedule
Jobs use a standard cron expression (minute, hour, day, month, weekday). Use the visual picker or enter the expression directly.

## Operation window
Optionally restrict execution to a time window (e.g. only between 02:00 and 06:00). Jobs outside the window are skipped.

## Approval workflow
If the Approval Workflow is enabled, scheduled jobs require pre-approval before their first execution.

> **Requires** Plus licence.

<!-- p3portal.org -->

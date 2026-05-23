# Image Factory – VM Templates

View and manage existing Proxmox VM templates across all configured nodes.

## What is shown
All VMs flagged as templates in Proxmox are listed here, including their node, creation date, and ID.

## Delete a template
Administrators can delete templates directly from this tab. The action is irreversible and requires confirmation.

## Using templates
VM templates are used as base images in VM Deployment playbooks. They appear in the OS template dropdown of the deploy form.

> Templates are read live from the Proxmox API and reflect the current cluster state.

<!-- p3portal.org -->

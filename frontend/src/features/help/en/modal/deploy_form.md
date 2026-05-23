# Deploy Form

The Deploy form builds a parameterised Ansible job to provision a new VM or LXC container.

## Fields
- **Node** – the Proxmox node to deploy on
- **Playbook** – the Ansible playbook to run (filtered by your permissions)
- **Parameters** – dynamically generated from the playbook's `meta.yaml`

## Required parameters
Fields marked with * must be filled in. The form validates inputs client-side before submitting.

## Job start
On submit, the portal creates a job and redirects you to the live log. If approval is required, you will see a confirmation screen instead.

<!-- p3portal.org -->
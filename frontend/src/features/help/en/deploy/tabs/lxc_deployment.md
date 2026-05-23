# LXC Deployment

Deploy new LXC containers on your Proxmox cluster using predefined Ansible playbooks.

## How it works
Select an LXC playbook from the list, fill in the required parameters, and click **Deploy**. The portal starts an Ansible job and streams the live output directly to you.

## Parameters
Typical LXC parameters include container name, CPU cores, RAM, disk size, and the base template. All parameters are defined in the playbook's `meta.yaml`.

## Permissions
Only playbooks matching your Proxmox role and the `lxc_deployment` category are shown here.

## After deployment
Newly created containers appear on the **Dashboard** once the Proxmox cache refreshes.

<!-- p3portal.org -->

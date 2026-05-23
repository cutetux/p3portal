# VM Deployment

Deploy new virtual machines on your Proxmox cluster using predefined Ansible playbooks.

## How it works
Select a playbook from the list, fill in the required parameters, and click **Deploy**. The portal starts an Ansible job and streams the live output directly to you.

## Parameters
Each playbook defines its own parameters (VM name, CPU, RAM, disk size, OS template, etc.) via a `meta.yaml` file. Required fields are marked with an asterisk.

## Permissions
Only playbooks matching your Proxmox role are shown. Contact your administrator if an expected playbook is missing.

## After deployment
Newly created VMs appear on the **Dashboard** once the Proxmox cache refreshes (usually within the configured poll interval).

<!-- p3portal.org -->

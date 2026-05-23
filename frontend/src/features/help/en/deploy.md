# VM / LXC Deployment

Use the Deployment page to provision new virtual machines or LXC containers via Ansible playbooks.

## Selecting a playbook
Choose the target node, then select a playbook from the dropdown. Each playbook has a category (VM Deployment, LXC Deployment, Configuration) and may require a specific Proxmox role.

## Filling in parameters
Parameters are generated dynamically from the playbook's `meta.yaml`. Required fields are marked with *.

## Running the job
Click **Deploy** to start the job. You will be redirected to the live log where you can watch Ansible output in real time.

## Approval workflow
If the approval workflow is enabled, your job may require a second administrator to approve it before it runs.

<!-- p3portal.org -->
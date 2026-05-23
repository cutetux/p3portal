# Automation – Playbooks

Run Ansible playbooks for infrastructure configuration and management tasks (not covered by the Deployment tabs).

## Difference to Deployment
While the Deployment page focuses on creating new VMs/LXCs, the Automation playbooks are used for reconfiguration, updates, and operational tasks on existing resources.

## Running a playbook
1. Select a playbook from the list on the left.
2. Fill in the parameters in the form on the right.
3. Click **Run** – the portal starts an Ansible job and streams the live output.

## Uploading playbooks
Administrators can upload new playbooks as a ZIP archive. The archive must contain the playbook directory with `meta.yaml` at the top level.

## Permissions
Visible playbooks depend on your role and any configured playbook whitelists.

<!-- p3portal.org -->

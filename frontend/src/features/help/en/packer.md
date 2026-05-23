# Template Builder (Packer)

The Template Builder lets you create reusable Proxmox VM templates using HashiCorp Packer.

## Starting a build
1. Select a Packer build definition from the list
2. Fill in the parameters (OS version, disk size, packages, etc.)
3. Click **Start Build** – the job runs in the background

## Monitoring progress
Open the job in the Events & Logs page to watch the Packer output live.

## Result
A finished template appears in your Proxmox datastore and becomes available in the VM Deployment dropdown.

## Uploading definitions
Admins can upload new Packer build definitions as ZIP archives containing `.pkr.hcl` and `meta.yaml`.

<!-- p3portal.org -->
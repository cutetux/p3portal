# Image Factory – VM Images (Packer Builds)

Build new VM images (Proxmox templates) using HashiCorp Packer directly from the portal.

## How it works
Select a Packer template from the list on the left. Fill in the build parameters and click **Build**. Packer runs inside the portal container and communicates with your Proxmox API to create a new VM template.

## Build parameters
Parameters are defined per template in `meta.yaml` (OS version, packages, cloud-init settings, etc.).

## Result
A finished Proxmox VM template is created on the target node. It can then be used in VM Deployment playbooks as a base image.

## Uploading Packer templates
Administrators can upload new Packer template directories as a ZIP archive.

<!-- p3portal.org -->

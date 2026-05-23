# Packer Build Form

Start a new Packer build to create a VM template on Proxmox.

## Fields
- **Build definition** – select from available Packer configurations
- **Target node** – Proxmox node where the template will be created
- **Parameters** – version, disk size, packages, etc. (from `meta.yaml`)

## Build process
Packer SSHs into a temporary VM, runs provisioners and converts the result to a template. This can take 5–30 minutes.

## Template naming
The template name is set in the Packer HCL. It will appear in the VM Deployment dropdown after the build completes.

<!-- p3portal.org -->
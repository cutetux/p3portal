# Clone VM (basic)

Minimal starter-pack example. Clones a cloud-init template into a new VM,
configures the network and SSH key, and starts it.

## What it does

1. Clones the chosen template (full clone)
2. Sets CPU cores and memory
3. Writes the cloud-init IP config (`ipconfig0`)
4. Writes the cloud-init SSH key (`sshkeys`)
5. Starts the VM

## Prerequisites

- A cloud-init-ready template exists on the target node
  (use the *Debian 13 minimal* Packer template to create one)
- The portal's service-account token has `PVEVMAdmin` on the node

## Limitations (by design)

- No disk resize, no DNS / search domain, no tags
- Either an SSH key or a root password (or both) — at least one must be set
- No multi-NIC, no LXC support
- Service-account auth only (Proxmox-login user not supported)

For anything beyond the basics, write your own playbook in
`ansible/<your-name>/`. This file is meant as a starting point, not a feature.

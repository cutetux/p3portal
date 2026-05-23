# P3 Portal Starter Pack

Minimal Ansible playbook and Packer template intended as a *learning example* —
not a production-grade setup. Use it to verify your Proxmox connection works and
to understand how the portal's `meta.yaml` parameter system works.

## Contents

```
ansible/vm-clone-basic/        Clone a cloud-init template into a new VM
packer/debian-13-minimal/      Build a small Debian 13 cloud-init template
```

## How to activate

The portal reads playbooks from `/app/ansible/` and Packer templates from
`/app/packer/` inside the container. If you mount your own directories via
docker-compose, copy the starter content over once:

```bash
cp -r examples/starter-pack/ansible/vm-clone-basic    ansible/
cp -r examples/starter-pack/packer/debian-13-minimal  packer/
```

After a portal restart both should appear in **Automation** and **Image
Factory** respectively.

## What this is NOT

* Not a hardened image — passwords/keys are placeholders.
* Not feature-complete — no LXC, no multi-NIC, no DNS/search domain,
  no disk resize for existing VMs, no `vm_access` modes (SSH-key only).
* Not maintained as a product surface — extend or replace as needed.

The portal's own ansible/packer volumes are the canonical place for your real
playbooks. This starter pack lives in the image purely so a fresh install has
*something* to click on.

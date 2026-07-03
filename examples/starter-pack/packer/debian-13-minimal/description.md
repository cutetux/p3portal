# Debian 13 minimal

Starter-pack Packer template. Builds a small Debian 13 cloud-init template
suitable for cloning by the *Clone VM (basic)* Ansible playbook.

## What it does

1. Boots the Debian netinst ISO with a minimal preseed (en_US, UTC; DHCP by default)
2. Installs `qemu-guest-agent` + `cloud-init`
3. Removes the placeholder root password
4. Proxmox converts the VM into a template

Build time: ~10 minutes depending on mirror speed.

## Prerequisites

### 1. Download the Debian 13 netinst ISO

Get the small ~700 MB network installer (NOT the full DVD or live image):

- Download page: https://www.debian.org/distrib/netinst
- Architecture: **amd64** (this template assumes x86_64; ARM is not supported)
- File: `debian-13.<x>.<y>-amd64-netinst.iso` — the exact point-release number changes every few months; pick whatever the page currently offers and update the `iso_file` parameter to match
- Verify the checksum (`SHA256SUMS` next to the ISO) before uploading

### 2. Upload the ISO to Proxmox

Either:

- **Via the portal** — *Image Factory → ISOs → Download ISO* (paste the URL above and pick `local` storage), or
- **Via the Proxmox web UI** — *Datacenter → Node → local → ISO Images → Upload*, or
- **Via SCP** — copy to `/var/lib/vz/template/iso/` on the Proxmox node

The default `iso_file` parameter expects the file on the `local` storage. If you put it elsewhere, edit the parameter when you start the build (format: `<storage>:iso/<filename>`).

### 3. Other requirements

- Portal Packer token must have rights to create/destroy VMs on the target node
  (including `Sys.AccessNetwork` for download-url; see `docs/token-usage.md`)
- The portal container must be reachable from the build VM on TCP port 8103
  (used to serve the preseed file during install)
- The build VM's network (`bridge` parameter) must let it reach an IP: either a
  DHCP server on that subnet (default), **or** fill in the static-network fields
  below. Without either, the Debian installer stops at *"Network
  autoconfiguration failed"* because it cannot fetch the preseed.

### Static network (no DHCP)

Leave **Static IP** empty to use DHCP (the default). If the build network has no
DHCP server, set:

| Field | Example | Notes |
|---|---|---|
| Static IP | `192.168.2.50` | A free IPv4 on the build subnet. Empty = DHCP |
| Netmask | `255.255.255.0` | |
| Gateway | `192.168.2.1` | Required when static — needed to reach the Debian mirror |
| DNS server | `192.168.2.1` | Required when static — no DNS = package install fails |

These are passed to the installer as kernel `netcfg/*` params, so it configures
the IP *before* fetching the preseed. This is build-time only; the resulting
template still uses cloud-init/DHCP per clone.

### 4. Pick the right storage pool

There is no sensible default — Proxmox installations differ. Common values:

| Setup | Storage pool name |
|---|---|
| Default Proxmox install (LVM-Thin) | `local-lvm` |
| ZFS root install | `local-zfs` (or your custom ZFS pool name) |
| External NFS / Ceph / CIFS | as configured under *Datacenter → Storage* |

List what's available on your node with `pvesh get /nodes/<node>/storage --output-format json | jq '.[] | select(.content | contains("images")) | .storage'`.

## Security notes

- The template configures cloud-init with `disable_root: false` and `ssh_pwauth: true` so Proxmox' `cipassword` + `sshkeys` actually take effect when the VM is cloned. This means **root login over SSH is enabled** — gate that with firewall rules or a private network, or switch to a non-root cloud-init user in your own copy.
- The build-time root password (`p3starter`) is left in the template intentionally — cloud-init overwrites it on the first clone boot. Do not skip cloud-init configuration; the password is documented and obvious.

## Limitations (by design)

- en_US locale, UTC timezone (change in your own copy of `http/preseed.cfg`)
- DHCP by default; optional static IP for build networks without DHCP (see above)
- Single 10 GB disk
- No extra users, no firewall, no custom packages

If you need any of that, copy this template into `packer/<your-name>/` and
adapt it. The starter pack is meant to be replaced, not extended.

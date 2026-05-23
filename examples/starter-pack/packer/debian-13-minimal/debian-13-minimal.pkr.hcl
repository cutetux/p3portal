# P3 Portal starter pack: minimal Debian 13 cloud-init template.
#
# Build flow:
#   1. Boot Debian netinst ISO with a tiny preseed (en_US, UTC, no extra packages)
#   2. Install qemu-guest-agent + cloud-init
#   3. Clear root password and bash history
#   4. Proxmox converts the VM into a template
#
# The root password during install is a placeholder ("p3starter") that is
# *removed* immediately after install — no login with password is possible
# on the resulting template. Cloud-init injects user keys per clone.

packer {
  required_plugins {
    proxmox = {
      version = "~> 1.2"
      source  = "github.com/hashicorp/proxmox"
    }
  }
}

# --- Connection (injected by portal backend) ----------------------------------

variable "proxmox_api_url" { type = string }

variable "proxmox_api_token_id" {
  type    = string
  default = ""
}
variable "proxmox_api_token_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "proxmox_api_user" {
  type    = string
  default = ""
}
variable "proxmox_api_password" {
  type      = string
  sensitive = true
  default   = ""
}

# --- meta.yaml parameters -----------------------------------------------------

variable "vm_id" { type = string }
variable "node"  { type = string }

variable "storage_pool" {
  type        = string
  description = "Proxmox storage pool for the VM disk (e.g. local-lvm, local-zfs, <your-zfs-pool>). No default — Proxmox setups vary too much."
}

variable "iso_file" {
  type    = string
  default = "local:iso/debian-13.4.0-amd64-netinst.iso"
}

variable "bridge" {
  type    = string
  default = "vmbr0"
}

# Portal-host IP reachable from the build VM (injected via PKR_VAR_packer_http_ip).
variable "packer_http_ip" {
  type    = string
  default = ""
}

# -----------------------------------------------------------------------------

source "proxmox-iso" "debian" {
  proxmox_url              = var.proxmox_api_url
  username                 = var.proxmox_api_user != "" ? var.proxmox_api_user : var.proxmox_api_token_id
  token                    = var.proxmox_api_user != "" ? "" : var.proxmox_api_token_secret
  password                 = var.proxmox_api_user != "" ? var.proxmox_api_password : ""
  insecure_skip_tls_verify = true

  node                 = var.node
  vm_id                = var.vm_id
  vm_name              = "tmpl-debian-13"
  template_description = "Debian 13 minimal cloud-init template (starter pack)"

  boot_iso {
    type             = "scsi"
    iso_file         = var.iso_file
    iso_storage_pool = "local"
    unmount          = true
  }

  qemu_agent      = true
  scsi_controller = "virtio-scsi-pci"
  cores           = "1"
  memory          = "1024"

  disks {
    type         = "scsi"
    storage_pool = var.storage_pool
    disk_size    = "10G"
    discard      = true
    ssd          = true
  }

  network_adapters {
    model    = "virtio"
    bridge   = var.bridge
    firewall = false
  }

  cloud_init              = true
  cloud_init_storage_pool = var.storage_pool

  boot_command = [
    "<esc><wait>",
    "auto <wait>",
    "preseed/url=http://${var.packer_http_ip}:{{ .HTTPPort }}/preseed.cfg ",
    "<enter>"
  ]
  boot      = "c"
  boot_wait = "5s"

  http_directory    = "http"
  http_bind_address = "0.0.0.0"
  http_port_min     = 8103
  http_port_max     = 8103

  # Temporary root password — wiped in provisioner below.
  ssh_username = "root"
  ssh_password = "p3starter"
  ssh_timeout  = "20m"
}

build {
  name    = "debian-13-minimal"
  sources = ["source.proxmox-iso.debian"]

  provisioner "shell" {
    inline = [
      "export DEBIAN_FRONTEND=noninteractive",
      "apt-get update",
      "apt-get install -y qemu-guest-agent cloud-init",
      "systemctl enable qemu-guest-agent",

      # cloud-init drop-in: only use Proxmox/NoCloud datasource, let root
      # auth via cipassword + sshkeys actually take effect (defaults block
      # both), and don't expire the cipassword on first boot (default expire
      # forces a password change that the Proxmox console can't drive).
      "mkdir -p /etc/cloud/cloud.cfg.d",
      "printf 'datasource_list: [ NoCloud, ConfigDrive ]\\ndisable_root: false\\nssh_pwauth: true\\nchpasswd:\\n  expire: false\\n' > /etc/cloud/cloud.cfg.d/99_pve.cfg",

      # Disable predictable interface names (Debian Trixie default would be
      # enp0s18 / ens18). Proxmox cloud-init network-config assumes 'eth0';
      # with PIN enabled the DHCP request never fires on the right interface
      # and the guest comes up IPv6-only via SLAAC.
      "sed -i 's|GRUB_CMDLINE_LINUX_DEFAULT=\"\\([^\"]*\\)\"|GRUB_CMDLINE_LINUX_DEFAULT=\"\\1 net.ifnames=0 biosdevname=0\"|' /etc/default/grub",
      "update-grub",

      # Drop the build-time sshd snippet that pinned PermitRootLogin to
      # prohibit-password — cloud-init's ssh_pwauth toggle handles it now.
      "rm -f /etc/ssh/sshd_config.d/packer.conf",

      # Keep the build-time root password as-is. cloud-init overwrites it on
      # the first clone boot via cipassword. Do NOT 'passwd -d root' — that
      # leaves an empty hash and lets PAM accept a blank console login.

      # Reset cloud-init so each clone gets a fresh instance-id
      "cloud-init clean --logs --seed",

      "rm -f /root/.bash_history",
      "history -c || true"
    ]
  }
}

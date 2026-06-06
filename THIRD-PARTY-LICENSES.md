# Third-Party Licenses

P3 Portal bundles third-party software in its container image. This file lists the
redistributed binaries and their licenses. Application dependencies installed via
`pip`/`npm` carry their own licenses and are not enumerated here.

## Bundled in the Core image (AGPLv3)

| Component | License | Source |
|---|---|---|
| HashiCorp Packer | BUSL-1.1 (binary redistribution permitted for non-competing use) | <https://github.com/hashicorp/packer> |
| packer-plugin-proxmox | MPL-2.0 | <https://github.com/hashicorp/packer-plugin-proxmox> |

## Bundled in the Plus image only (Stacks)

| Component | License | Source |
|---|---|---|
| OpenTofu | MPL-2.0 | <https://github.com/opentofu/opentofu> |
| bpg/terraform-provider-proxmox | MPL-2.0 | <https://github.com/bpg/terraform-provider-proxmox> |

OpenTofu and the bpg Proxmox provider are redistributed **unmodified** under the
Mozilla Public License 2.0. The pinned versions are set via the Docker build args
`OPENTOFU_VERSION` and `BPG_PROVIDER_VERSION`. The full MPL-2.0 text is available at
<https://www.mozilla.org/en-US/MPL/2.0/> and in each project's source repository.

OpenTofu (not Terraform, which is BUSL-1.1) was deliberately chosen as the Stacks engine
for license compatibility with the AGPLv3 core and the source-available Plus edition.

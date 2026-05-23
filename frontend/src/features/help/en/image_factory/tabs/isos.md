# Image Factory – ISOs

Download and manage ISO images on your Proxmox nodes for VM installation.

## Download an ISO
Enter a direct download URL to fetch an ISO file directly to the selected node's ISO storage. The download runs as a background job on Proxmox.

## Delete an ISO
Select an ISO from the list and delete it. Only administrators can delete ISOs.

## Node and storage selection
Each Proxmox node manages its own ISO storage. Use the node and storage dropdowns to choose the correct target location.

## Usage in VM deployment
ISO files appear as selectable options in VM deployment playbooks that use the `iso_file` parameter.

<!-- p3portal.org -->

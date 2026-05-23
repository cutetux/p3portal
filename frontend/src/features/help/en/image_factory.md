# Image Factory

The Image Factory manages LXC container templates (`.tar.zst` / `.tar.gz`) stored on your Proxmox nodes.

## Listing templates
The page shows all LXC templates available on each configured node.

## Downloading
Enter a URL (e.g. from a Proxmox download mirror) and click **Download**. The template is stored on the selected node's storage.

## Uploading
Upload a locally built template file directly to a node.

## Deleting
Remove templates you no longer need. This does **not** affect running containers.

<!-- p3portal.org -->
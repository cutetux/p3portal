# Create / Edit Node

Register or update a Proxmox node or cluster.

## URL
Enter the full URL including port, e.g. `https://pve.example.com:8006`.

## Cluster mode
Enable if this URL is a Proxmox cluster VIP. In cluster mode, all nodes in the cluster are imported automatically.

## API tokens
The portal requires at least a **viewer token** (`PVEAuditor` role). Operator and admin tokens enable progressively more actions.

## Packer token
A separate token for Packer builds. Needs `VM.Allocate`, `VM.Config.*` and `Datastore.AllocateSpace` privileges.

## Poll interval
How often (in seconds) the portal refreshes the node's data from the Proxmox API.

<!-- p3portal.org -->
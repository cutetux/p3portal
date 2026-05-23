# Nodes (System Settings)

Der Nodes-Tab listet alle registrierten Proxmox-Nodes und Cluster auf.

## Node hinzufügen
Klicke auf **+ Node hinzufügen** und fülle aus:
- **Anzeigename** – Label im Portal
- **Proxmox-URL** – z.B. `https://pve.example.com:8006`
- **Cluster-Modus** – aktivieren wenn die URL eine Proxmox-Cluster-VIP ist
- **API-Tokens** – Viewer-, Operator-, Admin- und Packer-Token

## Token-Anforderungen
Jedes Token ist ein Proxmox-API-Token im Format `user@realm!tokenid`. Das Portal speichert keine Proxmox-Passwörter.

<!-- p3portal.org -->
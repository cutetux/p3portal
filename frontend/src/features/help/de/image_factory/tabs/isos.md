# Image Factory – ISOs

Lade ISO-Images auf deine Proxmox-Nodes herunter und verwalte sie für die VM-Installation.

## ISO herunterladen
Gib eine direkte Download-URL ein, um eine ISO-Datei direkt auf den ISO-Speicher des ausgewählten Nodes zu laden. Der Download läuft als Hintergrund-Job auf Proxmox.

## ISO löschen
Wähle eine ISO aus der Liste und lösche sie. Nur Administratoren können ISOs löschen.

## Node- und Speicherauswahl
Jeder Proxmox-Node verwaltet seinen eigenen ISO-Speicher. Verwende die Node- und Speicher-Dropdowns, um den richtigen Zielort auszuwählen.

## Verwendung im VM-Deployment
ISO-Dateien erscheinen als auswählbare Optionen in VM-Deployment-Playbooks, die den Parameter `iso_file` verwenden.

<!-- p3portal.org -->

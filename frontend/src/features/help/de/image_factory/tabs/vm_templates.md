# Image Factory – VM Templates

Zeige und verwalte vorhandene Proxmox-VM-Templates über alle konfigurierten Nodes hinweg.

## Was angezeigt wird
Alle als Template markierten VMs in Proxmox werden hier aufgelistet, einschließlich Node, Erstellungsdatum und ID.

## Template löschen
Administratoren können Templates direkt aus diesem Tab löschen. Die Aktion ist nicht rückgängig zu machen und erfordert eine Bestätigung.

## Templates verwenden
VM-Templates werden als Basis-Images in VM-Deployment-Playbooks genutzt. Sie erscheinen im OS-Template-Dropdown des Deploy-Formulars.

> Templates werden live aus der Proxmox-API gelesen und spiegeln den aktuellen Cluster-Zustand wider.

<!-- p3portal.org -->

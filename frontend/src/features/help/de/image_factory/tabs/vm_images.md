# Image Factory – VM Images (Packer Builds)

Erstelle neue VM-Images (Proxmox-Templates) mit HashiCorp Packer direkt aus dem Portal.

## So funktioniert es
Wähle ein Packer-Template aus der Liste links. Fülle die Build-Parameter aus und klicke auf **Bauen**. Packer läuft im Portal-Container und kommuniziert mit deiner Proxmox-API, um ein neues VM-Template zu erstellen.

## Build-Parameter
Parameter werden pro Template in `meta.yaml` definiert (OS-Version, Pakete, Cloud-Init-Einstellungen usw.).

## Ergebnis
Ein fertiges Proxmox-VM-Template wird auf dem Ziel-Node erstellt. Es kann dann in VM-Deployment-Playbooks als Basis-Image verwendet werden.

## Packer-Templates hochladen
Administratoren können neue Packer-Template-Verzeichnisse als ZIP-Archiv hochladen.

<!-- p3portal.org -->

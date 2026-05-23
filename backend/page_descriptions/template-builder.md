# Template-Builder

Erstelle und verwalte **VM-Templates** für den Proxmox-Cluster –
vollautomatisch mit HashiCorp Packer, direkt als Basis für VM-Deployments verwendbar.

---

## Die drei Bereiche

**Build-Definitionen** – Packer-Builds starten. Wähle eine Definition links
aus, fülle die Parameter aus und starte den Build. Packer installiert das
Betriebssystem vollautomatisch per Preseed/Kickstart, richtet Cloud-Init ein
und konvertiert die VM anschließend in ein Proxmox-Template.

**VM-Templates** – Übersicht aller fertigen Templates auf dem Proxmox-Node.
Templates können von hier aus gelöscht werden wenn sie nicht mehr benötigt werden.

**ISO-Verwaltung** – ISOs direkt aus dem Internet auf den Proxmox-Node
herunterladen, vorhandene ISOs auflisten und löschen.

---

## Ablauf: Neues Template bauen

1. ISO herunterladen – *ISO-Verwaltung → ISO herunterladen*
2. Build-Definition auswählen – links in der Liste
3. Parameter ausfüllen:
   - **VM ID** – wird als temporäre Build-VM verwendet, danach als Template-ID
   - **Proxmox Node** – Ziel-Node (wird automatisch vorbelegt)
   - **Storage Pool** – wo Disk und Cloud-Init-Drive gespeichert werden
   - **ISO Datei** – Proxmox-Pfad zur heruntergeladenen ISO
4. Build starten – Packer läuft 15–35 Minuten je nach OS und ISO-Größe
5. Fertig – Template erscheint im VM-Deployment-Formular unter *Template VM*

---

## Eigene Build-Definition hochladen

Admins können eigene Packer-Definitionen hochladen:
- **`.pkr.hcl`** – die Packer-Build-Konfiguration
- **`meta.yaml`** – Name, Beschreibung, Rolle und Parameter für das Formular
- **`description.md`** – optional, Dokumentation die rechts im Panel erscheint

*Definition hochladen → Button oben rechts*

---

## Voraussetzungen

- Packer-API-Token in den Umgebungsvariablen gesetzt
  (`PACKER_TOKEN_ID`, `PACKER_TOKEN_SECRET`)
- SSH-Key-Datei `files/sysadm` im jeweiligen Template-Verzeichnis vorhanden
- `PACKER_HTTP_IP` gesetzt auf die IP des Portal-Hosts
  (Proxmox-VMs müssen diesen Host während des Builds per HTTP erreichen)

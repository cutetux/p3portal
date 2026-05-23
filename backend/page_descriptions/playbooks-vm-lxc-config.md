# VM/LXC Konfiguration

Passe bestehende virtuelle Maschinen und Container an –
ohne manuellen Zugriff auf Proxmox oder die CLI.

---

## Was du hier machen kannst

**Ressourcen anpassen** – CPU-Kerne, RAM und Disk-Größe einer laufenden VM
ändern. CPU und RAM können per Hotplug ohne Neustart geändert werden.

**Disk vergrößern** – Proxmox-seitige Erweiterung wird automatisch
durchgeführt. Das Dateisystem innerhalb der VM muss danach ggf. separat
erweitert werden (`growpart` / `resize2fs` / `xfs_growfs`).

---

## Wichtige Einschränkungen

**Disk-Verkleinerung ist nicht möglich.** Proxmox und die gängigen
Dateisysteme unterstützen das Verkleinern einer Partition nicht.
Für Verkleinerungen muss eine neue VM erstellt und die Daten migriert werden.

**VM-ID und Node müssen bekannt sein.** Beide sind im Dashboard sichtbar –
einfach die VM in der Tabelle anklicken oder die Spalten ablesen.

---

## Ablauf

1. **Playbook auswählen** – links in der Liste
2. **VM-ID und Node eingeben** – aus dem Dashboard
3. **Nur die Felder ausfüllen, die geändert werden sollen** – leere Felder
   bleiben unverändert
4. **Starten** – Änderung wird sofort auf Proxmox-Ebene wirksam

---

## Dateisystem nach Disk-Erweiterung

Nach einer Disk-Vergrößerung muss das Dateisystem **innerhalb der VM**
angepasst werden. Typische Befehle:

```bash
# Partition erweitern (wenn nötig)
growpart /dev/sda 1

# ext4-Dateisystem erweitern
resize2fs /dev/sda1

# XFS-Dateisystem erweitern
xfs_growfs /
```

Bei Cloud-Init-Templates aus dem Template-Builder ist `cloud-guest-utils`
bereits installiert – `growpart` steht sofort zur Verfügung.

---

## Admin: Playbook hinzufügen

Admins können neue Playbooks über den Button **„Playbook hochladen"** (oben rechts) als ZIP-Archiv importieren.

### ZIP-Struktur

```
mein-playbook.yml      ← Playbook-Datei (Pflicht)
meta.yaml              ← Portal-Metadaten (Pflicht)
description.md         ← Dokumentation (optional)
ROLLENNAME/            ← Ansible-Role (gleiche Ebene, optional)
  tasks/
    main.yml
  defaults/
    main.yml
```

Ein einzelner Wrapper-Ordner wird automatisch erkannt.

### meta.yaml – Pflichtfelder für diese Kategorie

```yaml
name: "Mein Konfigurations-Playbook"
description: "Kurzbeschreibung"
playbook: "mein-playbook.yml"
category: "vm_lxc_config"
required_role: "PVEVMAdmin"   # optional
parameters: []
```

### Gültige category-Werte

| Wert | Tab |
|---|---|
| `vm_deployment` | VM Deployment |
| `lxc_deployment` | LXC Deployment |
| `vm_lxc_config` | VM/LXC Konfiguration ← dieser Tab |

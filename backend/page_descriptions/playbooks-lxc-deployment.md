# LXC Deployment

Erstelle neue **Linux Container (LXC)** auf dem Proxmox-Cluster –
leichtgewichtig, ressourcenschonend und in Sekunden startbereit.

---

## LXC vs. VM – wann was?

**LXC** eignet sich für:
- Dienste und Daemons (nginx, Datenbanken, Monitoring-Agenten)
- Entwicklungsumgebungen und Build-Systeme
- Alles was keinen eigenen Kernel oder Windows benötigt

**VM** eignet sich für:
- Vollständige Betriebssystem-Isolation (eigener Kernel)
- Windows-Workloads
- Produktionssysteme mit strengen Sicherheitsanforderungen

---

## Voraussetzungen

- Ein CT-Template muss im Proxmox-Storage vorhanden sein.
  Verfügbare Templates anzeigen und herunterladen mit:

```bash
pveam update
pveam available
pveam download local debian-12-standard_12.2-1_amd64.tar.zst
```

- Ausreichende Proxmox-Berechtigungen für Container-Erstellung

---

## Noch keine Playbooks vorhanden

Dieser Bereich ist vorbereitet, aber noch kein LXC-Playbook definiert.

Ein Admin kann ein neues Playbook hinzufügen, indem eine `meta.yaml` mit
folgendem Eintrag erstellt wird:

```yaml
category: lxc_deployment
```

Die Datei kommt neben das zugehörige Ansible-Playbook und eine optionale
`description.md` für die Dokumentation.

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
name: "Mein LXC-Playbook"
description: "Kurzbeschreibung"
playbook: "mein-playbook.yml"
category: "lxc_deployment"
required_role: "PVEVMAdmin"   # optional
parameters: []
```

### Gültige category-Werte

| Wert | Tab |
|---|---|
| `vm_deployment` | VM Deployment |
| `lxc_deployment` | LXC Deployment ← dieser Tab |
| `vm_lxc_config` | VM/LXC Konfiguration |

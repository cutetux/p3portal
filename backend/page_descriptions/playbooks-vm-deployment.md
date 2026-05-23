# VM Deployment

Erstelle neue virtuelle Maschinen auf dem Proxmox-Cluster – vollautomatisch per Ansible,
ohne manuellen Zugriff auf die Proxmox-Oberfläche.

---

## Wie es funktioniert

Eine VM wird durch Klonen eines bestehenden **Cloud-Init-Templates** erstellt.
Das Template enthält bereits Betriebssystem, QEMU-Guest-Agent und Cloud-Init –
alle weiteren Einstellungen werden beim ersten Start per Cloud-Init gesetzt.

## Ablauf

1. **Playbook auswählen** – links in der Liste
2. **Preset wählen** (optional) – befüllt Formular mit Standardwerten für Small / Medium / Large
3. **Parameter ausfüllen** – Name, Ressourcen, Netzwerk, Zugang
4. **Build starten** – Job läuft im Hintergrund, Logs live unter *Jobs*
5. **Fertig** – die VM ist nach ca. 30–60 Sekunden per SSH erreichbar

---

## Parameter im Überblick

**VM Name** – wird als Proxmox-Name und Cloud-Init-Hostname gesetzt.

**VM ID** – eindeutige Proxmox-VM-ID. Wird automatisch aus dem konfigurierten
Bereich vorgeschlagen (Einstellungen → VM-ID-Bereich).

**Proxmox Node** – Ziel-Node für die neue VM. Wird automatisch vorbelegt
wenn nur ein Node konfiguriert ist.

**Template VM** – das Quell-Template für den Clone. Nur Templates auf dem
gewählten Node werden angezeigt.

**Full Clone** – empfohlen: erstellt eine vollständig unabhängige Kopie.
Linked Clones sind schneller, aber vom Template abhängig.

**RAM, CPU, Disk** – Ressourcen der neuen VM. Disk kann nach der Erstellung
nur vergrößert, nicht verkleinert werden.

**Netzwerk (Cloud-Init)** – `ip=dhcp` für automatische IP-Zuweisung, oder
`ip=192.168.1.50/24,gw=192.168.1.1` für eine feste IP-Adresse.

**VM-Zugang** – SSH-Key und/oder Passwort für Root und/oder einen Nutzer.
Der SSH-Key aus deinem Profil kann per Checkbox übernommen werden.

---

## Voraussetzungen

- Ein Cloud-Init-Template muss auf dem Ziel-Node vorhanden sein
- Eigenes SSH-Key-Paar (kann im Profil hinterlegt werden)
- Rolle `PVEVMAdmin` auf dem Ziel-Node

*Kein Template vorhanden? → Template-Builder → Build-Definition auswählen*

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
name: "Mein Playbook"
description: "Kurzbeschreibung"
playbook: "mein-playbook.yml"
category: "vm_deployment"
required_role: "PVEVMAdmin"   # optional
parameters: []
```

### Gültige category-Werte

| Wert | Tab |
|---|---|
| `vm_deployment` | VM Deployment ← dieser Tab |
| `lxc_deployment` | LXC Deployment |
| `vm_lxc_config` | VM/LXC Konfiguration |

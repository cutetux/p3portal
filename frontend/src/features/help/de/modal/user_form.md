# Nutzer anlegen / bearbeiten

Das Nutzerformular ermöglicht Admins das Anlegen und Konfigurieren von Portal-Nutzern.

## Auth-Typ
- **Lokal** – Portal verwaltet das Passwort
- **Proxmox** – Nutzer authentifiziert sich direkt gegen Proxmox

## Rollenpreset
Weist ein Proxmox-Rollenpreset zu, das den Zugriff auf VM-Operationen regelt.

## Portal-Berechtigungen
Fein-granulare Admin-Flags. Wichtige Berechtigungen:
- `manage_users` – andere Nutzer anlegen/bearbeiten
- `manage_nodes` – Proxmox-Nodes verwalten
- `manage_help` – Hilfetext-Overrides verwalten

<!-- p3portal.org -->
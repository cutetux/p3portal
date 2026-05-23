# Zeitgesteuerte Jobs (Plus)

Plane Ansible-Playbooks, SSH-Befehle und VM/LXC-Power-Aktionen, die automatisch nach einem Cron-Zeitplan ausgeführt werden.

## Job-Typen
- **Ansible Playbook** – führt ein beliebiges Playbook mit vordefinierten Parametern aus
- **SSH-Befehl** – führt einen Shell-Befehl auf einem Zielhost via SSH aus
- **Power-Aktion** – startet, stoppt oder startet eine VM oder einen LXC-Container neu

## Cron-Zeitplan
Jobs nutzen einen Standard-Cron-Ausdruck (Minute, Stunde, Tag, Monat, Wochentag). Nutze den visuellen Picker oder gib den Ausdruck direkt ein.

## Betriebsfenster
Optional kann die Ausführung auf ein Zeitfenster eingeschränkt werden (z.B. nur zwischen 02:00 und 06:00). Jobs außerhalb des Fensters werden übersprungen.

## Freigabe-Workflow
Wenn der Freigabe-Workflow aktiviert ist, benötigen zeitgesteuerte Jobs vor ihrer ersten Ausführung eine Vorab-Freigabe.

> **Erfordert** Plus-Lizenz.

<!-- p3portal.org -->

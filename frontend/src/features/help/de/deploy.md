# VM / LXC Deployment

Über die Deployment-Seite provisionierst du neue VMs oder LXC-Container per Ansible-Playbook.

## Playbook auswählen
Wähle den Ziel-Node und dann ein Playbook aus der Liste. Jedes Playbook hat eine Kategorie und kann eine bestimmte Proxmox-Rolle erfordern.

## Parameter ausfüllen
Die Parameter werden dynamisch aus der `meta.yaml` des Playbooks generiert. Pflichtfelder sind mit * markiert.

## Job starten
Klicke auf **Deploy**, um den Job zu starten. Du wirst zum Live-Log weitergeleitet.

## Freigabe-Workflow
Wenn der Freigabe-Workflow aktiv ist, muss ein zweiter Administrator den Job bestätigen, bevor er ausgeführt wird.

<!-- p3portal.org -->
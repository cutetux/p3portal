# VM Deployment

Starte neue virtuelle Maschinen auf deinem Proxmox-Cluster mit vordefinierten Ansible-Playbooks.

## So funktioniert es
Wähle ein Playbook aus der Liste, fülle die erforderlichen Parameter aus und klicke auf **Deployen**. Das Portal startet einen Ansible-Job und streamt die Live-Ausgabe direkt zu dir.

## Parameter
Jedes Playbook definiert seine eigenen Parameter (VM-Name, CPU, RAM, Festplattengröße, OS-Template usw.) über eine `meta.yaml`-Datei. Pflichtfelder sind mit einem Sternchen markiert.

## Berechtigungen
Es werden nur Playbooks angezeigt, die deiner Proxmox-Rolle entsprechen. Wende dich an deinen Administrator, wenn ein erwartetes Playbook fehlt.

## Nach dem Deployment
Neu erstellte VMs erscheinen im **Dashboard**, sobald der Proxmox-Cache aktualisiert wird (normalerweise innerhalb des konfigurierten Poll-Intervalls).

<!-- p3portal.org -->

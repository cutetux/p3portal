# LXC Deployment

Starte neue LXC-Container auf deinem Proxmox-Cluster mit vordefinierten Ansible-Playbooks.

## So funktioniert es
Wähle ein LXC-Playbook aus der Liste, fülle die erforderlichen Parameter aus und klicke auf **Deployen**. Das Portal startet einen Ansible-Job und streamt die Live-Ausgabe direkt zu dir.

## Parameter
Typische LXC-Parameter sind Container-Name, CPU-Kerne, RAM, Festplattengröße und das Basis-Template. Alle Parameter sind in der `meta.yaml` des Playbooks definiert.

## Berechtigungen
Hier werden nur Playbooks der Kategorie `lxc_deployment` angezeigt, die deiner Proxmox-Rolle entsprechen.

## Nach dem Deployment
Neu erstellte Container erscheinen im **Dashboard**, sobald der Proxmox-Cache aktualisiert wird.

<!-- p3portal.org -->

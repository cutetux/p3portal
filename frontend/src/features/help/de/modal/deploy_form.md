# Deploy-Formular

Das Deploy-Formular erstellt einen parametrisierten Ansible-Job zum Provisionieren einer VM oder eines LXC-Containers.

## Felder
- **Node** – Ziel-Proxmox-Node
- **Playbook** – auszuführendes Ansible-Playbook (nach Berechtigungen gefiltert)
- **Parameter** – dynamisch aus der `meta.yaml` des Playbooks generiert

## Pflichtfelder
Felder mit * müssen ausgefüllt werden. Das Formular validiert Eingaben clientseitig.

<!-- p3portal.org -->
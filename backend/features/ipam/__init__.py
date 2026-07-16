# p3portal.org
"""PROJ-42 Phase 1 – Core Simple-IPAM (Pools + best-effort Free-IP live aus Proxmox).

Zustandsloses Core-Modul: verwaltet IP-Pools je (Sub-)Netz und schlägt beim
Playbook-Deploy eine freie IP vor, berechnet live aus Proxmox (kein Allocation-
Store). Der zustandsbehaftete Teil (Reservierung/Lebenszyklus/Freigaben) ist
Phase 2 (Plus) und fasst dieses Modul additiv über den Mediator an.
"""

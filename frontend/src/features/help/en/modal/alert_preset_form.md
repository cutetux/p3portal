# Alert Preset Form (Plus)

Alert presets are reusable sets of alert rules that can be assigned to multiple VMs.

## Preset name
A descriptive name shown in the VM detail page and alert logs.

## Rules
Each rule consists of:
- **Metric** – CPU %, RAM %, disk %
- **Threshold** – trigger value (e.g. 90%)
- **Duration** – how long the threshold must be exceeded before alerting
- **Severity** – info, warning, critical

## Assigning a preset
Go to a VM's detail page → Alerting tab → assign the preset. The preset rules are merged with any global rules.

<!-- p3portal.org -->
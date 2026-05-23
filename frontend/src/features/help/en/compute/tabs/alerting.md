# Node Alerting (Plus)

Configure threshold-based alerts for a specific Proxmox node.

## Alert rules
Each rule monitors one metric (CPU, RAM, disk) and triggers when the value exceeds a threshold for a sustained period.

## Notification targets
Alerts can be sent via:
- Portal banner (always shown)
- Email (if SMTP is configured)
- Webhook (HTTP POST to an external URL)

## Global rules vs. node rules
Global alert rules (System Settings → Monitoring) apply to all nodes. Node-specific rules override or extend the global rules.

> **Requires** Plus licence and SMTP/webhook configuration.

<!-- p3portal.org -->
# P3 Portal – Commercial Licensing

## Licensing Overview

P3 Portal uses a dual-license model:

| Component | License | Applies to |
|---|---|---|
| **P3 Core** | AGPLv3 + §7(b) Author-Attribution | `backend/` (excl. `backend/plus/`), `frontend/src/` (excl. `frontend/src/plus/`) |
| **P3 Plus** | LICENSE-PLUS (Source-Available, Key-required) | `backend/plus/`, `frontend/src/plus/` |

### P3 Core – AGPLv3

The Core edition is free and open-source software licensed under the
**GNU Affero General Public License version 3 (AGPLv3)** with the
following additional permission under §7:

> *"You must preserve the notice 'Copyright (C) 2026 rootq
> <contact@rootq.de>' in all substantial portions of the software."*

This means:
- You may freely run, study, modify, and distribute Core.
- If you run a modified version as a network service, you must make your
  modifications available under AGPLv3.
- You **do not** need to add a UI logo or footer link (§7 only requires
  preserving the copyright notice).

### P3 Plus – SOURCE-AVAILABLE

Plus features are licensed under **LICENSE-PLUS** (see repo root):
- Source code is publicly readable for evaluation and security auditing.
- **Running** Plus features requires a valid Plus License Key (`plus.lic`).
- **Modification** is generally prohibited except for security patches and
  own-use adaptations under the CLA-assignment clause (see LICENSE-PLUS §4).
- **Redistribution** is prohibited.

---

## Status

> **P3 Plus is not sold commercially.**
>
> Plus licenses are currently issued **free of charge upon request** —
> for evaluation, self-hosting, or development purposes.
> There is no purchase process and no fee.
>
> License requests are evaluated individually.  The author is under no
> obligation to grant a license and may decline any request without
> giving reasons.
>
> Licenses are valid for **1 year** by default unless a different
> validity period is stated in the license file.
>
> The author reserves the right to introduce commercial Plus-license
> pricing at any future point in time.
>
> To request a Plus license, contact **license@p3portal.org**.

---

## Plus License Key Workflow

1. Contact **license@p3portal.org** to request a Plus license.
2. If approved, you receive a `plus.lic` file individually bound to your
   instance (valid for 1 year by default).
3. Mount `plus.lic` into the container at `/app/plus.lic`.
4. Plus features activate automatically at container startup.

Keys use envelope encryption and are individually bound — a key issued
for one instance cannot activate a different instance.

License files are **not** stored in this repository (`.gitignore` rule: `*.lic`).

---

## Feature Comparison: Core vs. Plus

| Feature | Core | Plus |
|---|---|---|
| Proxmox cluster dashboard | ✓ | ✓ |
| Ansible Playbook runner | ✓ | ✓ |
| Packer template builder | ✓ | ✓ |
| Job history & live logs | ✓ | ✓ |
| Single Proxmox node | ✓ | ✓ |
| Multi-node / multi-cluster | — | ✓ |
| Alert presets & SMTP alerts | — | ✓ |
| Scheduled jobs (Celery) | — | ✓ |
| Resource pools with quotas | — | ✓ |
| Approval workflow | — | ✓ |
| Theme editor (color picker) | — | ✓ |

---

## Trade Marks

The names "P3 Portal", "rootq", "p3portal.org", and "rootq.de" are
**not** licensed under AGPLv3 or LICENSE-PLUS.  See **TRADEMARK.md**
for details.

---

## Contact

- License enquiries: **license@p3portal.org**
- Project website: **https://p3portal.org**

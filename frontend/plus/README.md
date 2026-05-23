# P3 Portal – Plus Edition (Frontend)

This directory contains frontend code for the **P3 Plus** edition.

## License

All code in this directory is licensed under the **GNU Affero General Public License v3 (AGPLv3)**.  
See [`LICENSE`](../../LICENSE) in the repository root for the full license text.

Activating Plus features requires a valid `plus.lic` licence key.  
See [`COMMERCIAL.md`](../../COMMERCIAL.md) for details.

## What belongs here

- Multi-node cluster views (ClusterStatusBar with quorum/HA, node comparison)
- Multi-instance UI (instance switcher, per-host dashboards)
- Any UI component that only activates with a valid Plus licence

## Important

Basis-edition code (`frontend/src/`) must **never** import from `frontend/plus/`.  
Plus-edition code may freely import Basis components.

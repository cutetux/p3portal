# P3 Portal – Plus Edition (Backend)

This directory contains backend code for the **P3 Plus** edition.

## License

All code in this directory is licensed under the **GNU Affero General Public License v3 (AGPLv3)**.  
See [`LICENSE`](../../LICENSE) in the repository root for the full license text.

Activating Plus features requires a valid `plus.lic` licence key.  
See [`COMMERCIAL.md`](../../COMMERCIAL.md) for details.

## What belongs here

- Multi-node cluster API integrations (P3 Plus v1)
- Multi-instance Proxmox support (P3 Plus v2)
- Any feature that requires a valid Plus licence (`/app/plus.lic`)

## Important

Basis-edition code (`backend/` outside this directory) must **never** import from `backend/plus/`.  
Plus-edition code may freely import from the Basis codebase.

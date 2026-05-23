# P3 Portal API Policy

<!-- p3portal.org -->

## Overview

P3 Portal exposes a machine-readable REST API under `/api/`. This policy describes authentication, authorization, rate limiting and versioning for all external integrations.

---

## Authentication

### JWT (interactive sessions)

Browser sessions and direct API calls from signed-in users use JWT bearer tokens issued by `POST /api/auth/login`:

```
Authorization: Bearer <jwt>
```

JWT tokens carry no scope restrictions — they are gated only by Portal RBAC (roles and `portal_permissions`).

### User API Keys – `upk_` (external integrations)

All external integrations (CI/CD, scripting, M2M) **must** use personal API keys of the form `upk_<random>`:

```
Authorization: Bearer upk_<key>
```

- Keys are managed per user in **System Settings → API Keys**
- Each key carries a list of scopes granted by a Portal admin
- A key inherits no permissions beyond its scope list
- Scopes are additive: if a scope is missing, the endpoint answers with **HTTP 403**

**Note:** the legacy `p3k_` prefix (v1 M2M keys) is no longer supported. Migrate existing integrations to `upk_` keys.

---

## Scopes

The full scope list is available at `GET /api/scopes/manifest` (JWT or `upk_` auth required).

| Scope | Meaning |
|---|---|
| `cluster:read` | Read cluster status, nodes, VMs/LXCs |
| `jobs:read` | Read job status and logs |
| `jobs:write` | Start jobs (run playbooks) |
| `packer:read` | Read Packer template list and build status |
| `packer:write` | Start Packer builds |
| `playbooks:read` | List available playbooks |
| `playbooks:write` | Run playbooks directly (= `jobs:write`) |
| `groups:read` | Read group list |
| `pools:read` | Read resource pools |
| `owners:read` | Read VM owner assignments |
| `approvals:read` | Read approval requests |
| `approvals:approve` | Approve or reject approval requests |

**Aliases** — these scope names are transparently mapped to their canonical scope:

| Alias | Canonical |
|---|---|
| `jobs:start` | `jobs:write` |
| `packer:start` | `packer:write` |

---

## Rate limiting

`upk_` keys are subject to a per-key token bucket:

- **Default limit:** 600 requests / minute (configurable via `UPK_RATE_LIMIT_PER_MIN`)
- On overflow: **HTTP 429** with a `Retry-After` header (seconds until refill)
- Each key has its own bucket — a user with multiple keys gets the full limit per key
- JWT sessions are exempt from rate limiting

---

## Version compatibility

### `GET /api/version`

Public endpoint, no auth required:

```json
{
  "version": "1.60.0",
  "api_compat_level": "1",
  "edition": "core"
}
```

- `api_compat_level`: integer as string. Bumped only on breaking API changes. Integrations should check this value for compatibility.
- `edition`: `"core"` or `"plus"` — determines which scopes and features are available.

### Breaking changes

Breaking changes are signalled by bumping `api_compat_level`. Non-breaking additions (new fields, new scopes) ship without a bump.

---

## Callback URLs

Jobs (`POST /api/jobs`) and Packer builds (`POST /api/packer/build`) accept an optional `callback_url` field (a valid HTTPS URL):

```json
{
  "playbook": "deploy_vm",
  "params": { ... },
  "callback_url": "https://ci.example.com/webhook/p3/job-done"
}
```

The portal sends an HTTP POST to this URL once the job is finished (status `success`, `failed` or `cancelled`). The payload looks like:

```json
{
  "job_id": "abc123",
  "status": "success",
  "playbook": "deploy_vm",
  "finished_at": "2026-05-14T12:00:00Z"
}
```

Approval workflow: when an approval request is rejected or expires, the callback is triggered **once** with `"status": "rejected"` or `"status": "expired"`.

---

## Asynchronous approvals (approval workflow)

When the approval workflow is enabled and a job requires approval, the endpoint answers with **HTTP 202** instead of 201:

```json
{
  "approval_id": "appr_xyz",
  "poll_url": "/api/approvals/appr_xyz",
  "message": "Awaiting approval"
}
```

The approval status can be polled via `poll_url`. If `callback_url` was set, the caller receives an automatic notification on approval or rejection (no polling required).

---

## Migration guide v1 → current

| Old (v1) | New |
|---|---|
| `Authorization: Bearer p3k_<key>` | `Authorization: Bearer upk_<key>` |
| `/api/v1/jobs` | `/api/jobs` |
| `/api/v1/cluster` | `/api/cluster` |
| `/api/v1/packer/build` | `/api/packer/build` |
| Scope `jobs` | Scope `jobs:write` |
| Scope `cluster` | Scope `cluster:read` |

New keys must be created under **My Account → API Keys** in the portal and granted the required scopes by an admin.

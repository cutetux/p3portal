# User API Keys

<!-- p3portal.org -->

Personal API tokens let you use P3 Portal programmatically — without putting a username and password into your script. The key authenticates as your portal account; every action is performed under your identity.

**Prerequisite:** an administrator must enable API keys for your account.

---

## Create a key

1. Click your username at the top right → **Profile**
2. Open the **API Keys** tab
3. Click **New key**
4. Pick a name (e.g. `gitlab-ci` or `monitoring`)
5. Select the required permissions (scopes)
6. Pick an expiry: 30 / 90 / 180 / 365 days or **Unlimited**
7. Click **Create**

The key is shown **once** in clear text. Copy it immediately — it cannot be viewed again afterwards.

---

## Use a key

API keys are passed as a bearer token in the `Authorization` header:

```
Authorization: Bearer upk_<your-key>
```

### curl

```bash
curl -s \
  -H "Authorization: Bearer upk_abc123..." \
  https://portal.example.com/api/cluster/nodes
```

### Python (requests)

```python
import requests

PORTAL_URL = "https://portal.example.com"
API_KEY    = "upk_abc123..."

headers = {"Authorization": f"Bearer {API_KEY}"}

# List cluster nodes
nodes = requests.get(f"{PORTAL_URL}/api/cluster/nodes", headers=headers)
nodes.raise_for_status()
print(nodes.json())

# Start a playbook job
job = requests.post(
    f"{PORTAL_URL}/api/jobs",
    headers=headers,
    json={
        "type": "playbook",
        "playbook": "vm-deploy",
        "node": "pve1",
        "parameters": {"vm_name": "test-vm", "vm_cores": 2}
    }
)
job.raise_for_status()
print(job.json())  # {"job_id": "...", "status": "running"}
```

### GitLab CI / GitHub Actions

Store the key as a CI variable (e.g. `P3_API_KEY`) — never paste it directly into the pipeline file.

**GitLab CI (`.gitlab-ci.yml`):**

```yaml
deploy:
  script:
    - |
      curl -s -X POST "$P3_PORTAL_URL/api/jobs" \
        -H "Authorization: Bearer $P3_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"type":"playbook","playbook":"vm-deploy","node":"pve1","parameters":{"vm_name":"ci-vm"}}'
```

**GitHub Actions:**

```yaml
- name: Trigger playbook
  run: |
    curl -s -X POST "${{ vars.P3_PORTAL_URL }}/api/jobs" \
      -H "Authorization: Bearer ${{ secrets.P3_API_KEY }}" \
      -H "Content-Type: application/json" \
      -d '{"type":"playbook","playbook":"vm-deploy","node":"pve1","parameters":{"vm_name":"ci-vm"}}'
```

---

## Scopes

Scopes restrict what a key may do. When creating a key, pick only the scopes you really need (least-privilege principle).

| Scope | Allows |
|---|---|
| `cluster:read` | Read cluster status, nodes, VMs |
| `playbooks:read` | List available playbooks |
| `jobs:read` | Read your own jobs and their status/logs |
| `jobs:write` | Start jobs (run playbooks) |
| `packer:read` | List Packer templates |
| `packer:write` | Start Packer builds |

A key can only carry scopes the admin has enabled for your account.

---

## Expiry

| Option | Recommended for |
|---|---|
| **30 days** | Short-lived automations, test environments |
| **90 days** | CI/CD pipelines with regular rotation |
| **180 / 365 days** | Long-lived integrations with expiry reminders |
| **Unlimited** | Only if manual rotation is guaranteed |

Expired keys are rejected automatically (HTTP 401). The key entry remains visible in the list (for audit purposes) but is no longer active.

---

## Manage keys

The key list (Profile → API Keys) shows all your keys with:

- **Name** and **prefix** (first 12 characters of the key for identification)
- **Scopes**, **Created**, **Expires**, **Last used**

### Revoke a key

Use the **Revoke** button in the row of the key. The effect is immediate — running requests fail with 401 from the next call onwards.

---

## Limits

| Edition | Max. keys |
|---|---|
| P3 Core | 1 active key |
| P3 Plus | Configurable by admin (default: 5) |

---

## Error handling

| HTTP status | Cause |
|---|---|
| `401 Unauthorized` | Key invalid, expired, revoked, or admin has disabled access |
| `403 Forbidden` | Key scope is not sufficient for this endpoint |
| `429 Too Many Requests` | Portal rate limit exceeded |

All 401 responses are intentionally generic — the exact reason is not differentiated in the response body.

---

## Security notes

- **Keys are shown only once.** Transfer the value immediately to a secret management system (Vault, GitHub Secrets, GitLab CI Variables).
- **Minimal scopes.** Grant only the scopes the script actually needs.
- **No keys in code.** Never commit keys to a repository. Add `.env` files to `.gitignore`.
- **Prefer short expiries** for keys that get rotated automatically.
- **Revoke a compromised key immediately** — Profile → API Keys → Revoke.

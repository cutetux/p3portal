# Security Policy

Thanks for taking the time to look at the security of P3 Portal. Coordinated
disclosure is genuinely appreciated and is how we want to handle security
issues going forward.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.** A public
issue exposes other operators to the same attack before a fix is available.

Use one of these private channels instead:

1. **GitHub private vulnerability reporting (preferred):**
   <https://github.com/P3Portal-org/p3portal/security/advisories/new>
2. **Email:** `contact@rootq.de`
   - PGP welcome but not required. Encrypt with the key on
     <https://rootq.de> if you handle particularly sensitive payloads.

When you report, the following information helps us triage quickly:

- Affected component (file path, route, or feature) and the P3 Portal
  version or commit you tested against
- **Host OS** (distribution and version, e.g. `Debian 12.5`, `Fedora 41`,
  `RHEL 9.4`)
- **Container runtime and version** – Podman (`podman --version`) or Docker
  (`docker --version`), plus `podman-compose` / `docker compose` version if
  you used compose
- Reproducer (smallest possible, including request payload or ZIP / file
  contents)
- Impact – what a malicious user can read, write, or escalate to
- Suggested fix or mitigation, if you have one

The runtime matters because P3 Portal supports both Podman (rootless,
default in our docs) and Docker, and a few behaviours differ between them
(filesystem layering, UID mapping, network defaults). Telling us which one
you used cuts the back-and-forth on bugs that are not portable.

## What to expect

- **Acknowledgement** within 5 business days
- **Initial assessment** (confirmed / not reproducible / needs more info)
  within 10 business days
- **Fix timeline** depends on severity:
  - Critical (RCE, arbitrary write outside the sandbox, auth bypass to
    admin): patched in days, advisory + release tag
  - High (privilege escalation between portal roles, data exfiltration):
    patched in 2–3 weeks
  - Medium / Low: bundled into the next regular release
- **Credit** in the release notes and the GitHub security advisory if you
  want it – just tell us how you'd like to be named (handle, real name,
  link). Anonymous reports are also fine.

## Scope

In scope:

- The portal backend (`backend/`), frontend (`frontend/src/`), and the
  container image we publish (`ghcr.io/p3portal-org/p3portal`)
- Default configuration and the bundled `examples/starter-pack`
- Authentication, authorization, file upload paths, secret handling

Out of scope:

- Issues that require a malicious Proxmox cluster the operator already
  trusts (the trust boundary is the cluster, not P3 Portal)
- Denial of service from a fully privileged admin user
- Findings against forks or significantly modified deployments
- Public-internet exposure: P3 Portal is built for LAN / VPN deployment.
  Wrapping it with a reverse proxy for public exposure is the operator's
  responsibility and not in scope here.

## Supported versions

Only the most recent `:latest` and `:core` images on `ghcr.io/p3portal-org`
receive security patches. Older tags are kept for reproducibility but are
not patched.

## Once a fix is released

We will publish a GitHub Security Advisory describing the issue, affected
versions, and the fixed release. If you reported it and want credit, you'll
be named there.

## Hall of thanks

Researchers who have helped harden P3 Portal:

- [@cutetux](https://github.com/cutetux) – Zip-Slip in playbook upload +
  `require_admin` bypass (GitHub
  [#4](https://github.com/P3Portal-org/p3portal/issues/4), fixed in
  [`v1.74.6-beta`](https://github.com/P3Portal-org/p3portal/releases/tag/v1.74.6-beta))

Thank you. Open source is only as safe as the people who take the time to
look at the code.

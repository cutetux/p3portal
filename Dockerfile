# rootq.de
# syntax=docker/dockerfile:1

# ── Stage 1: Frontend build ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /build

COPY frontend/package*.json ./
RUN npm ci --prefer-offline

ARG FRONTEND_CACHE_BUST=1
COPY frontend/ ./

# PROJ-69: EDITION=core ersetzt die echte Plus-Registry durch einen leeren Stub,
# sodass keine Plus-Komponenten in den Vite-Bundle gelangen.
# EDITION=plus (Default) lässt den echten index.js unberührt.
ARG EDITION=plus
RUN if [ "$EDITION" = "core" ]; then \
        cp src/plus/index.core.js src/plus/index.js; \
    fi

RUN npm run build

# ── Stage 2: Final image ─────────────────────────────────────────────────────
FROM python:3.12-slim

# PROJ-69: EDITION steuert ob Plus-Code im Image enthalten ist.
#   EDITION=plus  (Default) — vollständiges Image mit backend/plus/ + Plus-Frontend
#   EDITION=core            — reines AGPLv3-Image, backend/plus/ wird entfernt
# Verwendung: docker build --build-arg EDITION=core -t p3portal:latest .
ARG EDITION=plus

ARG PACKER_VERSION=1.11.2

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_ROOT_USER_ACTION=ignore

# System-Abhängigkeiten
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        unzip \
        git \
        openssh-client \
        openssl \
        gosu \
    && rm -rf /var/lib/apt/lists/*

# Packer Binary installieren
RUN curl -fsSL \
        "https://releases.hashicorp.com/packer/${PACKER_VERSION}/packer_${PACKER_VERSION}_linux_amd64.zip" \
        -o /tmp/packer.zip \
    && unzip /tmp/packer.zip -d /usr/local/bin/ \
    && rm /tmp/packer.zip \
    && chmod +x /usr/local/bin/packer

# Non-root User anlegen (UID 1001 > SYS_UID_MAX, daher kein -r)
RUN useradd -u 1001 -g users -s /bin/bash -m -d /home/portal portal

WORKDIR /app

# Python-Abhängigkeiten
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir ansible ansible-runner

# Ansible Collections
COPY ansible/requirements.yml ./ansible/requirements.yml
RUN ansible-galaxy collection install -r ./ansible/requirements.yml

# Packer-Plugin-Verzeichnis (shared, für alle User lesbar)
ENV PACKER_PLUGIN_PATH=/app/.packer.d/plugins
RUN mkdir -p "${PACKER_PLUGIN_PATH}"

# packer-plugin-proxmox installieren (benötigt Netzwerkzugriff beim Build)
RUN packer plugins install github.com/hashicorp/proxmox || true

# Anwendungscode
COPY backend/ ./backend/
COPY ansible/ ./ansible/
COPY packer/ ./packer/
COPY examples/ ./examples/

# PROJ-69: Plus-Backend im Core-Build entfernen.
# rm-after-COPY ist die Docker-idiomatische Lösung, da COPY keine Bedingungen kennt.
# backend/core/plus_protocol.py bleibt in beiden Builds erhalten (Core-Infrastruktur).
RUN if [ "$EDITION" = "core" ]; then \
        rm -rf /app/backend/plus/ && \
        echo "PROJ-69: backend/plus/ removed (EDITION=core)"; \
    fi

# PROJ-72: Lizenz-Dateien ins Image kopieren.
# LICENSE ist immer im Build-Context (AGPLv3 Core-Lizenz).
# LICENSE-PLUS nur im Plus-Build-Context (durch Plus-CI-Overlay platziert)
# bzw. heute auch noch in github/ als Phase-A-Übergangszustand.
# Das Glob `LICENSE*` löst sich immer auf, weil LICENSE garantiert vorhanden ist.
COPY LICENSE* /app/

# PROJ-17: Plus-Lizenz-Token (verschlüsselt, gleich für alle Kunden)
COPY plus.enc /app/plus.enc

# Frontend-Build aus Stage 1
COPY --from=frontend-builder /build/dist/ ./frontend/dist/

# Daten-Verzeichnis & Entrypoint
RUN mkdir -p /app/data /app/ssl \
    && chown -R portal:users /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8443

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -fk https://localhost:8443/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]

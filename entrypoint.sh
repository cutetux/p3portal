#!/bin/sh
# rootq.de
set -e

# Podman rootless: kein gosu nötig (Container-Root = Host-User)
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

# PROJ-67 Phase 1 – β: Valkey/Redis-Passwort automatisch generieren wenn nicht vorhanden
VALKEY_PWD_FILE="/app/data/valkey.pwd"
if [ ! -f "${VALKEY_PWD_FILE}" ]; then
    openssl rand -hex 32 > "${VALKEY_PWD_FILE}"
    chmod 644 "${VALKEY_PWD_FILE}"
fi

# Starter pack: kopiert ein minimales Beispiel nach ansible/ und packer/, falls
# diese leer sind (frische Installation). Marker in /app/data verhindert
# wiederholtes Einkopieren — wer das Beispiel löscht, bekommt es nicht zurück.
# cp -n (no-clobber) überschreibt nie bestehende Dateien des Nutzers.
STARTER_MARKER=/app/data/.starter-pack-installed
STARTER_SRC=/app/examples/starter-pack
if [ ! -f "${STARTER_MARKER}" ] && [ -d "${STARTER_SRC}" ]; then
    if cp -rn "${STARTER_SRC}/ansible/." /app/ansible/ \
        && cp -rn "${STARTER_SRC}/packer/." /app/packer/; then
        touch "${STARTER_MARKER}"
        echo "Starter pack installed into /app/ansible/ and /app/packer/"
    else
        echo "WARN: starter pack copy failed — are ansible/+packer/ mounts writable?" >&2
    fi
fi

SSL_DIR=/app/ssl
CERT="${SSL_DIR}/portal.crt"
KEY="${SSL_DIR}/portal.key"

if [ ! -f "${CERT}" ] || [ ! -f "${KEY}" ]; then
    openssl req -x509 -nodes -newkey rsa:2048 \
        -keyout "${KEY}" \
        -out "${CERT}" \
        -days 3650 \
        -subj "/CN=proxmox-portal.local" \
        -addext "subjectAltName=IP:127.0.0.1,DNS:localhost"
fi

exec uvicorn backend.main:app \
    --host 0.0.0.0 \
    --port 8443 \
    --ssl-keyfile "${KEY}" \
    --ssl-certfile "${CERT}"

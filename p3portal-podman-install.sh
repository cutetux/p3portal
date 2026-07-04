#!/bin/bash
# p3portal.org
#
# P3 Portal - rootless Podman installer for Debian/Ubuntu.
#
# Creates a dedicated user, writes a self-contained podman-compose stack
# (Valkey + portal + celery worker) plus a systemd --user service with linger,
# and starts it. The compose file is written inline on purpose so the installer
# stays self-contained and offline-capable. Keep it in sync with the canonical
# ./docker-compose.yml in this repository if the service layout changes.
#
# Run as root:  sudo ./p3portal-podman-install.sh

set -euo pipefail

# --- must run as root -------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
    echo "This installer must run as root (it installs packages and creates a user)." >&2
    echo "Try: sudo $0" >&2
    exit 1
fi

# --- CONFIGURATION ---

# --- APP_NAME ---
echo "Choose app name:"
echo "  1) p3portal (default)"
echo "  2) Custom name"
read -rp "Choice [1]: " APP_NAME_CHOICE
APP_NAME_CHOICE="${APP_NAME_CHOICE:-1}"

if [[ "$APP_NAME_CHOICE" == "2" ]]; then
    read -rp "Custom app name: " APP_NAME
    until [[ -n "$APP_NAME" ]]; do
        read -rp "Must not be empty. Custom app name: " APP_NAME
    done
else
    APP_NAME="p3portal"
fi
APP_USER="$APP_NAME"

echo ""

# --- IMAGE ---
# Core: ghcr.io/p3portal-org/p3portal        (AGPLv3, fully open source)
# Plus: ghcr.io/p3portal-org/p3portal-plus   (source-available, unlock via licence / 30-day trial)
echo "Choose image:"
select opt in "Core (AGPLv3, fully open source)   -> p3portal" \
              "Plus (source-available/licensed)   -> p3portal-plus"; do
    case $REPLY in
        1) IMAGE="p3portal"; break ;;
        2) IMAGE="p3portal-plus"; break ;;
        *) echo "Please choose 1 or 2." ;;
    esac
done

echo ""

# --- SECRET_KEY ---
echo "Choose SECRET_KEY:"
echo "  1) Generate automatically (recommended)"
echo "  2) Set your own (min. 32 characters)"
read -rp "Choice [1]: " SECRET_CHOICE
SECRET_CHOICE="${SECRET_CHOICE:-1}"

if [[ "$SECRET_CHOICE" == "2" ]]; then
    read -rp "SECRET_KEY (min. 32 characters): " SECRET_KEY
    while [[ ${#SECRET_KEY} -lt 32 ]]; do
        echo "Too short (${#SECRET_KEY} characters). At least 32 characters required."
        read -rp "SECRET_KEY (min. 32 characters): " SECRET_KEY
    done
else
    SECRET_KEY=$(openssl rand -hex 32)
fi

echo ""

# --- PORTS ---
validate_port() {
    local port="$1"
    # rootless podman cannot bind to ports < 1024 without CAP_NET_BIND_SERVICE
    [[ "$port" =~ ^[0-9]+$ ]] && (( port >= 1024 && port <= 65535 ))
}

read -rp "HTTPS port (portal web UI) [8443]: " HTTPS_PORT
HTTPS_PORT="${HTTPS_PORT:-8443}"
while ! validate_port "$HTTPS_PORT"; do
    echo "Invalid port. Please enter a number between 1024 and 65535 (rootless podman cannot bind lower ports)."
    read -rp "HTTPS port (portal web UI) [8443]: " HTTPS_PORT
    HTTPS_PORT="${HTTPS_PORT:-8443}"
done

read -rp "Packer HTTP server port (build VMs fetch the preseed here) [8103]: " HTTP_PORT
HTTP_PORT="${HTTP_PORT:-8103}"
while ! validate_port "$HTTP_PORT" || [[ "$HTTP_PORT" == "$HTTPS_PORT" ]]; do
    if [[ "$HTTP_PORT" == "$HTTPS_PORT" ]]; then
        echo "Packer HTTP port must differ from the HTTPS port ($HTTPS_PORT)."
    else
        echo "Invalid port. Please enter a number between 1024 and 65535 (rootless podman cannot bind lower ports)."
    fi
    read -rp "Packer HTTP server port [8103]: " HTTP_PORT
    HTTP_PORT="${HTTP_PORT:-8103}"
done

INSTALL_DIR="/home/$APP_USER/podman/$APP_NAME"
SERVER_IP=$(hostname -I | awk '{print $1}')
HTTPS_URL="https://${SERVER_IP}:${HTTPS_PORT}"

# --- SYSTEM PREPARATION (ROOT) ---
apt update && apt upgrade -y
apt install sudo podman podman-compose slirp4netns -y

# Configure registries via a drop-in so we don't clobber an existing
# /etc/containers/registries.conf on the host.
mkdir -p /etc/containers/registries.conf.d
cat <<'EOF' > /etc/containers/registries.conf.d/p3portal.conf
unqualified-search-registries = ["docker.io"]
EOF

# Create user & enable linger (so the user service runs without an active login)
if ! id "$APP_USER" &>/dev/null; then
    useradd -m -s /bin/bash "$APP_USER"
fi
loginctl enable-linger "$APP_USER"

# Set user environment
BASHRC="/home/$APP_USER/.bashrc"
if ! grep -q "XDG_RUNTIME_DIR" "$BASHRC"; then
    echo 'export XDG_RUNTIME_DIR=/run/user/$(id -u)' >> "$BASHRC"
fi

# Create directories
SERVICE_DIR="/home/$APP_USER/.config/systemd/user"
mkdir -p "$INSTALL_DIR/ansible" \
         "$INSTALL_DIR/packer" \
         "$INSTALL_DIR/data" \
         "$SERVICE_DIR"

# --- CREATE CONFIG FILES ---

# .env file
cat <<EOF > "$INSTALL_DIR/.env"
TZ=Europe/Berlin
SECRET_KEY=${SECRET_KEY}
EOF

# podman-compose.yml (written inline; keep in sync with ./docker-compose.yml)
cat <<EOF > "$INSTALL_DIR/podman-compose.yml"
# p3portal.org
# Container image registry (GHCR):
#   Core (AGPLv3, fully open source): ghcr.io/p3portal-org/p3portal:latest
#   Plus (source-available, unlock via licence / 30-day trial):
#                                     ghcr.io/p3portal-org/p3portal-plus:latest
# Most Plus features (Stacks, topology, auto snapshots, declarative firewall, ...)
# only work with the Plus image. Re-run this installer and pick Plus, or switch
# the \`image:\` lines of the \`portal\` and \`celery-worker\` services below.

networks:
  portal-net:
    driver: bridge

services:
  valkey:
    image: valkey/valkey:8-alpine
    restart: unless-stopped
    networks:
      - portal-net
    security_opt:
      - no-new-privileges:true
    mem_limit: 256m

  celery-worker:
    image: ghcr.io/p3portal-org/${IMAGE}:latest
    restart: unless-stopped
    networks:
      - portal-net
    command: celery -A backend.celery_app worker --beat -l info
    env_file:
      - .env
    volumes:
      - ./ansible:/app/ansible
      - ./packer:/app/packer
      - ./data:/app/data
    environment:
      - VALKEY_URL=redis://valkey:6379/0
    security_opt:
      - no-new-privileges:true
    mem_limit: 1g
    depends_on:
      - valkey

  portal:
    image: ghcr.io/p3portal-org/${IMAGE}:latest
    restart: unless-stopped
    networks:
      - portal-net
    ports:
      - "${HTTPS_PORT}:8443"
      - "${HTTP_PORT}:8103"
    env_file:
      - .env
    volumes:
      - ./ansible:/app/ansible
      - ./packer:/app/packer
      - ./data:/app/data
    environment:
      - VALKEY_URL=redis://valkey:6379/0
    security_opt:
      - no-new-privileges:true
    mem_limit: 1g
    depends_on:
      - valkey
EOF

# --- SYSTEMD USER SERVICE ---
cat <<EOF > "$SERVICE_DIR/podman-compose-$APP_NAME.service"
[Unit]
Description=Podman Compose $APP_NAME
After=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/podman-compose up -d
ExecStop=/usr/bin/podman-compose down

[Install]
WantedBy=default.target
EOF

# --- SET OWNERSHIP ---
chown -R "$APP_USER:$APP_USER" "/home/$APP_USER"

# Pull images
su - "$APP_USER" -c "export XDG_RUNTIME_DIR=/run/user/\$(id -u); podman-compose -f '$INSTALL_DIR/podman-compose.yml' pull"

# Enable service
su - "$APP_USER" <<EOF
export XDG_RUNTIME_DIR=/run/user/\$(id -u)
systemctl --user daemon-reload
systemctl --user enable podman-compose-$APP_NAME.service
systemctl --user start podman-compose-$APP_NAME.service
EOF

echo "------------------------------------------------"
echo "Setup finished!"
echo "Portal URL (HTTPS):      ${HTTPS_URL}"
echo "Packer HTTP server port: ${HTTP_PORT} (build VMs fetch the preseed here; not a web UI)"
echo "User: ${APP_USER}   Install dir: ${INSTALL_DIR}"
echo "------------------------------------------------"

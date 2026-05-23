# p3portal.org
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, field_validator


class SnapshotCreateRequest(BaseModel):
    name: str
    description: str = ""

    @field_validator("name")
    @classmethod
    def valid_name(cls, v: str) -> str:
        v = v.strip()
        if not re.match(r"^[a-zA-Z0-9_\-]{1,40}$", v):
            raise ValueError("name must be 1–40 alphanumeric characters, dashes, or underscores")
        return v


class SnapshotInfo(BaseModel):
    name: str
    description: str = ""
    parent: str = ""
    snaptime: int | None = None


class VmTaskResponse(BaseModel):
    task_id: str


class ServiceAccountStatusResponse(BaseModel):
    viewer: bool
    operator: bool
    admin: bool


# ── VM Detail Page models (PROJ-29) ───────────────────────────────────────────

class NetworkInterface(BaseModel):
    id: str        # "net0", "net1"
    model: str     # "virtio", "e1000", etc.
    bridge: str    # "vmbr0"
    mac: str       # "AA:BB:CC:DD:EE:FF"


class DiskConfig(BaseModel):
    id: str       # "scsi0", "rootfs", "mp0"
    storage: str  # "local-lvm"
    size: str     # raw Proxmox value: "32G", "512M", "1T"


class VmDetailResponse(BaseModel):
    vmid: int
    name: str
    type: str             # "qemu" | "lxc"
    status: str           # "running" | "stopped" | "paused"
    node: str
    ip: str | None = None
    uptime: int = 0
    tags: list[str] = []
    is_template: bool = False
    cpu_usage: float | None = None   # None when stopped
    cpu_cores: int = 1
    mem_used: int | None = None      # bytes; None when stopped
    mem_total: int = 0               # bytes
    bios: str = ""
    ostype: str = ""
    networks: list[NetworkInterface] = []
    disks: list[DiskConfig] = []
    # PROJ-32: extended config fields (from existing vm_config call, no extra API call)
    cpu_type: str | None = None
    sockets: int | None = None
    onboot: bool | None = None
    protection: bool | None = None
    description: str | None = None
    lxc_hostname: str | None = None      # LXC only
    lxc_ostemplate: str | None = None    # LXC only
    # PROJ-48: portal DB node ID (FK on nodes table), needed for owner endpoints
    portal_node_id: int | None = None


# ── PROJ-32: Guest-Info & LXC-Interface models ────────────────────────────────

class FilesystemInfo(BaseModel):
    mountpoint: str
    total_bytes: int
    used_bytes: int
    fstype: str


class GuestInfoResponse(BaseModel):
    os_name: str | None = None
    os_version: str | None = None
    kernel: str | None = None
    arch: str | None = None
    hostname: str | None = None
    timezone: str | None = None
    timezone_offset: int | None = None   # seconds from UTC
    filesystems: list[FilesystemInfo] = []
    truncated_count: int = 0


class LxcNetworkInterface(BaseModel):
    name: str
    inet: str | None = None    # IPv4 with prefix, e.g. "192.168.1.10/24"
    inet6: str | None = None   # IPv6 with prefix
    hwaddr: str | None = None  # MAC address


class BackupFile(BaseModel):
    volid: str            # "local:backup/vzdump-qemu-100-..."
    filename: str         # "vzdump-qemu-100-..."
    created_at: int | None = None   # Unix timestamp
    size: int = 0         # bytes
    storage: str          # "local"


class BackupSchedule(BaseModel):
    id: str
    schedule: str         # "0 2 * * *"
    storage: str
    mode: str             # "snapshot" | "stop" | "suspend"
    compress: str = ""    # "zstd" | "lzo" | "gzip" | "0"
    enabled: bool = True
    comment: str = ""


class VmBackupsResponse(BaseModel):
    backups: list[BackupFile] = []
    schedules: list[BackupSchedule] = []
    storages: list[str] = []  # available backup storage names on this node


class BackupCreateRequest(BaseModel):
    storage: str
    mode: Literal["snapshot", "stop", "suspend"] = "snapshot"
    compress: Literal["zstd", "lzo", "gzip", "0"] = "zstd"


class BackupDeleteRequest(BaseModel):
    volid: str
    storage: str

# p3portal.org
from pydantic import BaseModel, field_validator


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def min_length(cls, v: str) -> str:
        if len(v) < 10:
            raise ValueError("Passwort muss mindestens 10 Zeichen haben")
        return v


class SshKeyRequest(BaseModel):
    key: str

    @field_validator("key")
    @classmethod
    def validate_key(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("SSH-Key darf nicht leer sein")
        allowed_prefixes = (
            "ssh-rsa", "ssh-ed25519", "ssh-dss",
            "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521",
            "sk-ssh-ed25519", "sk-ecdsa-sha2-nistp256",
        )
        if not any(v.startswith(p) for p in allowed_prefixes):
            raise ValueError("Ungültiges SSH-Key-Format")
        return v


class SshKeyResponse(BaseModel):
    key: str | None


_SSH_PREFIXES = (
    "ssh-rsa", "ssh-ed25519", "ssh-dss",
    "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521",
    "sk-ssh-ed25519", "sk-ecdsa-sha2-nistp256",
)


class SshKeyCreateRequest(BaseModel):
    label: str
    key: str

    @field_validator("label")
    @classmethod
    def validate_label(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Bezeichnung darf nicht leer sein")
        if len(v) > 60:
            raise ValueError("Bezeichnung darf maximal 60 Zeichen haben")
        return v

    @field_validator("key")
    @classmethod
    def validate_key(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("SSH-Key darf nicht leer sein")
        if not any(v.startswith(p) for p in _SSH_PREFIXES):
            raise ValueError("Ungültiges SSH-Key-Format")
        return v


class SshKeyOut(BaseModel):
    id: int
    label: str
    public_key: str
    created_at: str


class SessionResponse(BaseModel):
    id: str
    created_at: str
    expires_at: str
    ip_address: str | None
    user_agent: str | None
    is_current: bool


class MyGroupEntry(BaseModel):
    id: int
    name: str
    owner_username: str | None


class ProfileResponse(BaseModel):
    username: str
    auth_type: str
    role: str
    must_change_pw: bool
    must_setup_2fa: bool = False  # PROJ-106: Zwangs-Enrollment offen?
    last_login_at: str | None
    last_login_ip: str | None
    groups: list[MyGroupEntry] = []


# ── PROJ-106: Zwei-Faktor-Authentifizierung ───────────────────────────────────

class TwoFactorStatusResponse(BaseModel):
    enabled: bool
    pending: bool
    enforced: bool


class TwoFactorSetupResponse(BaseModel):
    secret: str          # Base32-Klartext (manueller Schlüssel)
    otpauth_uri: str
    qr_svg: str          # eigenständiges SVG-Dokument


class TwoFactorVerifyRequest(BaseModel):
    code: str

    @field_validator("code")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Code darf nicht leer sein")
        return v


class TwoFactorActivateResponse(BaseModel):
    recovery_codes: list[str]
    access_token: str    # frisches Token ohne must_setup_2fa


class TwoFactorDisableRequest(BaseModel):
    code: str | None = None       # aktueller TOTP-/Recovery-Code
    password: str | None = None   # ODER Passwort-Bestätigung


class TwoFactorRecoveryResponse(BaseModel):
    recovery_codes: list[str]


class SshJobKeyStatus(BaseModel):
    has_key: bool
    public_key: str | None = None   # aus dem gespeicherten Private Key abgeleitet


class SshJobKeyRequest(BaseModel):
    private_key: str
    risk_confirmed: bool

    @field_validator("risk_confirmed")
    @classmethod
    def must_confirm(cls, v: bool) -> bool:
        if not v:
            raise ValueError("Risiko-Bestätigung ist erforderlich")
        return v

    @field_validator("private_key")
    @classmethod
    def validate_private_key(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Privater Key darf nicht leer sein")
        if not v.startswith("-----BEGIN"):
            raise ValueError("Ungültiges PEM-Format – privater Key erwartet")
        return v


class GenerateKeyPairResponse(BaseModel):
    public_key: str


class ResetPasswordRequest(BaseModel):
    new_password: str

    @field_validator("new_password")
    @classmethod
    def min_length(cls, v: str) -> str:
        if len(v) < 10:
            raise ValueError("Passwort muss mindestens 10 Zeichen haben")
        return v

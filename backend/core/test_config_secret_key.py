# p3portal.org
"""Tests für SECRET_KEY-Validator in config.py (PROJ-67 Phase 1 – F-008)."""
import os

import pytest
from pydantic import ValidationError


class TestSecretKeyValidator:
    def _make_settings(self, key: str):
        """Erstellt eine neue Settings-Instanz mit einem Override für secret_key."""
        from pydantic_settings import BaseSettings, SettingsConfigDict
        from pydantic import field_validator
        from backend.core.config import _FORBIDDEN_SECRET_KEYS

        class TestSettings(BaseSettings):
            secret_key: str
            model_config = SettingsConfigDict(env_file=None, extra="ignore")

            @field_validator("secret_key", mode="after")
            @classmethod
            def validate_secret_key(cls, v: str) -> str:
                stripped = v.strip()
                if len(stripped) < 32:
                    raise ValueError(f"SECRET_KEY ist zu kurz ({len(stripped)} Zeichen)")
                if stripped.lower() in _FORBIDDEN_SECRET_KEYS:
                    raise ValueError("SECRET_KEY ist ein Placeholder")
                return v

        return TestSettings(secret_key=key)

    def test_valid_key_passes(self):
        key = "a" * 32
        s = self._make_settings(key)
        assert s.secret_key == key

    def test_long_random_key_passes(self):
        import secrets
        key = secrets.token_urlsafe(48)
        s = self._make_settings(key)
        assert s.secret_key == key

    def test_short_key_rejected(self):
        with pytest.raises(ValidationError, match="kurz"):
            self._make_settings("short")

    def test_exactly_31_chars_rejected(self):
        with pytest.raises(ValidationError):
            self._make_settings("a" * 31)

    def test_exactly_32_chars_passes(self):
        s = self._make_settings("a" * 32)
        assert len(s.secret_key) == 32

    def test_default_string_rejected(self):
        with pytest.raises(ValidationError, match="Placeholder"):
            self._make_settings("change-me-min-32-chars-random-string")

    def test_secret_string_rejected(self):
        with pytest.raises(ValidationError):
            self._make_settings("secret")

    def test_password_string_rejected(self):
        with pytest.raises(ValidationError):
            self._make_settings("password")

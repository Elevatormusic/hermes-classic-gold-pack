"""Read-only telemetry for the Classic Gold desktop plug-in."""

from __future__ import annotations

import copy
import csv
import io
import json
import math
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, cast

import psutil
from fastapi import APIRouter, Query
from hermes_state import SessionDB

router = APIRouter()
_MIB = 1024**2
_HARDWARE_CACHE_TTL_SECONDS = 1.0
_hardware_cache_lock = threading.Lock()
_hardware_cache: tuple[float, dict[str, Any]] | None = None
_NVIDIA_PATHS = (
    Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "nvidia-smi.exe",
    Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
    / "NVIDIA Corporation"
    / "NVSMI"
    / "nvidia-smi.exe",
)


def _ram() -> dict[str, Any]:
    try:
        memory = psutil.virtual_memory()
        return {
            "status": "ok",
            "source": "psutil",
            "used_bytes": int(memory.used),
            "available_bytes": int(memory.available),
            "total_bytes": int(memory.total),
            "percent": float(memory.percent),
        }
    except Exception as exc:
        return {"status": "unavailable", "source": "psutil", "reason": str(exc)}


def _nvidia_smi() -> str | None:
    for path in _NVIDIA_PATHS:
        if path.is_file():
            return str(path)
    return shutil.which("nvidia-smi")


def _vram() -> dict[str, Any]:
    executable = _nvidia_smi()
    if not executable:
        return {
            "status": "unavailable",
            "source": "nvidia-smi",
            "reason": "nvidia-smi was not found",
            "devices": [],
        }

    command = [
        executable,
        "--query-gpu=index,name,memory.total,memory.used,memory.free",
        "--format=csv,noheader,nounits",
    ]
    startup: Any | None = None
    if os.name == "nt":
        startup_factory = getattr(subprocess, "STARTUPINFO", None)
        if startup_factory is not None:
            startup = startup_factory()
            startup.dwFlags |= getattr(subprocess, "STARTF_USESHOWWINDOW", 0)

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            check=False,
            creationflags=(
                getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
            ),
            encoding="utf-8",
            errors="replace",
            shell=False,
            startupinfo=startup,
            timeout=2,
        )
        if result.returncode != 0:
            raise RuntimeError(
                result.stderr.strip() or f"nvidia-smi exited with {result.returncode}"
            )

        devices = []
        for row in csv.reader(io.StringIO(result.stdout)):
            if len(row) != 5:
                raise ValueError("nvidia-smi returned an unexpected row")
            index, name, total, used, free = [item.strip() for item in row]
            if any(item.upper() == "N/A" for item in (total, used, free)):
                raise ValueError("nvidia-smi did not report memory values")
            total_bytes = int(float(total) * _MIB)
            used_bytes = int(float(used) * _MIB)
            free_bytes = int(float(free) * _MIB)
            if min(total_bytes, used_bytes, free_bytes) < 0 or total_bytes <= 0:
                raise ValueError("nvidia-smi returned invalid memory values")
            devices.append(
                {
                    "index": int(index),
                    "name": name,
                    "used_bytes": used_bytes,
                    "free_bytes": free_bytes,
                    "total_bytes": total_bytes,
                    "percent": round(used_bytes / total_bytes * 100, 1),
                }
            )
        if not devices:
            raise ValueError("nvidia-smi returned no devices")

        used_bytes = sum(cast(int, device["used_bytes"]) for device in devices)
        free_bytes = sum(cast(int, device["free_bytes"]) for device in devices)
        total_bytes = sum(cast(int, device["total_bytes"]) for device in devices)
        return {
            "status": "ok",
            "source": "nvidia-smi",
            "used_bytes": used_bytes,
            "free_bytes": free_bytes,
            "total_bytes": total_bytes,
            "percent": round(used_bytes / total_bytes * 100, 1),
            "devices": devices,
        }
    except Exception as exc:
        return {
            "status": "unavailable",
            "source": "nvidia-smi",
            "reason": str(exc),
            "devices": [],
        }


def _hardware_resources() -> dict[str, Any]:
    """Return a cached RAM and VRAM sample."""
    global _hardware_cache

    with _hardware_cache_lock:
        now = time.monotonic()
        if _hardware_cache is not None:
            sampled_at, resources = _hardware_cache
            age = now - sampled_at
            if 0 <= age < _HARDWARE_CACHE_TTL_SECONDS:
                return copy.deepcopy(resources)

        resources = {"ram": _ram(), "vram": _vram()}
        _hardware_cache = (time.monotonic(), resources)
        return copy.deepcopy(resources)


def _session_row(session_id: str | None) -> tuple[dict[str, Any] | None, str | None]:
    if not session_id:
        return None, None
    try:
        database = SessionDB(read_only=True)
        try:
            cursor = database._conn.execute(  # noqa: SLF001 - narrow read avoids prompt data
                """
                SELECT cwd, git_branch, model, billing_provider, model_config,
                       actual_cost_usd, cost_status, cost_source, input_tokens,
                       cache_read_tokens, cache_write_tokens
                FROM sessions
                WHERE id = ?
                """,
                (session_id,),
            )
            raw_row = cursor.fetchone()
            row = dict(raw_row) if raw_row is not None else None
        finally:
            database.close()
        return row or None, None
    except Exception as exc:
        return None, str(exc)


def _cost(row: dict[str, Any] | None, error: str | None) -> dict[str, Any]:
    if error:
        return {"status": "unknown", "actual_cost_usd": None, "reason": error}
    if not row:
        return {"status": "unknown", "actual_cost_usd": None}
    try:
        status = str(row.get("cost_status") or "unknown")
        actual = row.get("actual_cost_usd")
        if status == "included":
            return {"status": "included", "actual_cost_usd": 0.0}
        if status == "estimated":
            return {"status": status, "actual_cost_usd": None}
        if status != "actual" or actual is None:
            return {"status": "unknown", "actual_cost_usd": None}
        amount = float(actual)
        if not math.isfinite(amount) or amount < 0:
            raise ValueError("the actual cost is not a finite, nonnegative value")
        return {
            "status": "actual",
            "actual_cost_usd": amount,
            "source": row.get("cost_source"),
        }
    except Exception as exc:
        return {"status": "unknown", "actual_cost_usd": None, "reason": str(exc)}


def _token_count(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("token count must be a nonnegative integer")
    number = float(value)
    if not math.isfinite(number) or number < 0 or not number.is_integer():
        raise ValueError("token count must be a nonnegative integer")
    return int(number)


def _cache_hit_rate(row: dict[str, Any] | None, error: str | None) -> dict[str, Any]:
    if error:
        return {"status": "unavailable", "reason": error}
    if not row:
        return {"status": "unavailable"}
    try:
        input_tokens = _token_count(row.get("input_tokens"))
        cache_read_tokens = _token_count(row.get("cache_read_tokens"))
        cache_write_tokens = _token_count(row.get("cache_write_tokens"))
    except (TypeError, ValueError, OverflowError) as exc:
        return {"status": "unavailable", "reason": str(exc)}
    denominator_tokens = input_tokens + cache_read_tokens + cache_write_tokens
    if cache_read_tokens <= 0 or denominator_tokens <= 0:
        return {"status": "unavailable"}
    return {
        "status": "ok",
        "input_tokens": input_tokens,
        "cache_read_tokens": cache_read_tokens,
        "cache_write_tokens": cache_write_tokens,
        "denominator_tokens": denominator_tokens,
        "hit_rate": cache_read_tokens / denominator_tokens,
    }


def _session_metadata(row: dict[str, Any] | None, error: str | None) -> dict[str, Any]:
    if error:
        return {"status": "unavailable", "reason": error}
    if not row:
        return {"status": "unavailable"}
    try:
        model_config = row.get("model_config") or {}
        if isinstance(model_config, str):
            try:
                model_config = json.loads(model_config)
            except (TypeError, ValueError):
                model_config = {}
        if not isinstance(model_config, dict):
            model_config = {}
        reasoning = model_config.get("reasoning_config") or {}
        if not isinstance(reasoning, dict):
            reasoning = {}
        effort = (
            "none"
            if reasoning.get("enabled") is False
            else str(reasoning.get("effort") or "")
        )
        service_tier = str(model_config.get("service_tier") or "")
        return {
            "status": "ok",
            "cwd": str(row.get("cwd") or ""),
            "git_branch": str(row.get("git_branch") or ""),
            "model": str(model_config.get("model") or row.get("model") or ""),
            "provider": str(
                model_config.get("provider") or row.get("billing_provider") or ""
            ),
            "reasoning_effort": effort,
            "fast": service_tier == "priority",
        }
    except Exception as exc:
        return {"status": "unavailable", "reason": str(exc)}


@router.get("/telemetry")
def telemetry(
    session_id: str | None = Query(default=None, max_length=256)
) -> dict[str, Any]:
    """Return resource readings, session display data, and reported cost."""
    row, error = _session_row(session_id)
    return {
        "schema_version": 1,
        "sampled_at_unix_ms": int(time.time() * 1000),
        "resources": _hardware_resources(),
        "cost": _cost(row, error),
        "cache": _cache_hit_rate(row, error),
        "session": _session_metadata(row, error),
    }

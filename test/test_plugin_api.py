"""Tests for the Classic Gold telemetry API."""

from __future__ import annotations

import importlib.util
import inspect
import json
import sys
import threading
import time
import types
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
PLUGIN_API = ROOT / "backend" / "classic-gold" / "dashboard" / "plugin_api.py"


def _load_plugin_api():
    """Load the API with a small Hermes state stub."""
    hermes_state = types.ModuleType("hermes_state")
    hermes_state.SessionDB = object
    module_name = f"classic_gold_plugin_api_test_{uuid.uuid4().hex}"
    spec = importlib.util.spec_from_file_location(module_name, PLUGIN_API)
    if spec is None or spec.loader is None:
        raise RuntimeError("The Classic Gold API module could not be loaded")
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {"hermes_state": hermes_state}):
        spec.loader.exec_module(module)
    return module


class PluginApiTests(unittest.TestCase):
    """Verify the hardware sample and route contract."""

    def setUp(self):
        self.api = _load_plugin_api()

    def test_ram_reports_the_stable_schema(self):
        memory = SimpleNamespace(used=4, available=6, total=10, percent=40.0)
        with patch.object(self.api.psutil, "virtual_memory", return_value=memory):
            result = self.api._ram()

        self.assertEqual(
            result,
            {
                "status": "ok",
                "source": "psutil",
                "used_bytes": 4,
                "available_bytes": 6,
                "total_bytes": 10,
                "percent": 40.0,
            },
        )

    def test_ram_reports_an_unavailable_sample(self):
        with patch.object(
            self.api.psutil,
            "virtual_memory",
            side_effect=RuntimeError("RAM data is not available"),
        ):
            result = self.api._ram()

        self.assertEqual(
            result,
            {
                "status": "unavailable",
                "source": "psutil",
                "reason": "RAM data is not available",
            },
        )

    def test_vram_uses_a_fixed_no_shell_command_and_aggregates_devices(self):
        executable = str(Path("C:/NVIDIA/nvidia-smi.exe"))
        completed = SimpleNamespace(
            returncode=0,
            stdout=(
                "0, RTX 3090, 24576, 6144, 18432\n" "1, RTX A4000, 12288, 3072, 9216\n"
            ),
            stderr="",
        )
        with (
            patch.object(self.api, "_nvidia_smi", return_value=executable),
            patch.object(self.api.subprocess, "run", return_value=completed) as run,
        ):
            result = self.api._vram()

        command = [
            executable,
            "--query-gpu=index,name,memory.total,memory.used,memory.free",
            "--format=csv,noheader,nounits",
        ]
        run.assert_called_once()
        self.assertEqual(run.call_args.args[0], command)
        self.assertIs(run.call_args.kwargs["shell"], False)
        self.assertEqual(run.call_args.kwargs["timeout"], 2)
        self.assertTrue(run.call_args.kwargs["capture_output"])

        mib = 1024**2
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["source"], "nvidia-smi")
        self.assertEqual(result["used_bytes"], 9216 * mib)
        self.assertEqual(result["free_bytes"], 27648 * mib)
        self.assertEqual(result["total_bytes"], 36864 * mib)
        self.assertEqual(result["percent"], 25.0)
        self.assertEqual(len(result["devices"]), 2)
        self.assertEqual(result["devices"][0]["name"], "RTX 3090")
        self.assertEqual(result["devices"][1]["index"], 1)

    def test_vram_reports_missing_and_failed_tools_as_unavailable(self):
        with patch.object(self.api, "_nvidia_smi", return_value=None):
            missing = self.api._vram()

        self.assertEqual(
            missing,
            {
                "status": "unavailable",
                "source": "nvidia-smi",
                "reason": "nvidia-smi was not found",
                "devices": [],
            },
        )

        completed = SimpleNamespace(returncode=1, stdout="", stderr="driver error")
        with (
            patch.object(self.api, "_nvidia_smi", return_value="nvidia-smi"),
            patch.object(self.api.subprocess, "run", return_value=completed),
        ):
            failed = self.api._vram()

        self.assertEqual(failed["status"], "unavailable")
        self.assertEqual(failed["source"], "nvidia-smi")
        self.assertEqual(failed["devices"], [])
        self.assertEqual(failed["reason"], "driver error")

    def test_hardware_cache_reuses_and_copies_a_recent_sample(self):
        ram = {"status": "ok", "source": "psutil", "used_bytes": 1}
        vram = {"status": "unavailable", "source": "nvidia-smi", "devices": []}
        with (
            patch.object(self.api, "_ram", return_value=ram) as read_ram,
            patch.object(self.api, "_vram", return_value=vram) as read_vram,
            patch.object(self.api.time, "monotonic", side_effect=[10.0, 10.1, 10.5]),
        ):
            first = self.api._hardware_resources()
            second = self.api._hardware_resources()

        first["ram"]["used_bytes"] = 99
        self.assertEqual(second["ram"]["used_bytes"], 1)
        self.assertEqual(read_ram.call_count, 1)
        self.assertEqual(read_vram.call_count, 1)

    def test_hardware_cache_allows_one_sample_for_parallel_calls(self):
        call_count = 8
        start = threading.Barrier(call_count)
        ram = {"status": "ok", "source": "psutil"}
        vram = {"status": "unavailable", "source": "nvidia-smi", "devices": []}

        def read_ram():
            time.sleep(0.05)
            return ram

        ram_mock = Mock(side_effect=read_ram)
        vram_mock = Mock(return_value=vram)

        def read_resources(_):
            start.wait()
            return self.api._hardware_resources()

        with (
            patch.object(self.api, "_ram", ram_mock),
            patch.object(self.api, "_vram", vram_mock),
            ThreadPoolExecutor(max_workers=call_count) as pool,
        ):
            results = list(pool.map(read_resources, range(call_count)))

        self.assertEqual(len(results), call_count)
        self.assertEqual(ram_mock.call_count, 1)
        self.assertEqual(vram_mock.call_count, 1)

    def test_cost_reports_an_actual_session_charge(self):
        row = {
            "cost_status": "actual",
            "actual_cost_usd": "1.125",
            "cost_source": "provider-usage",
        }

        self.assertEqual(
            self.api._cost(row, None),
            {
                "status": "actual",
                "actual_cost_usd": 1.125,
                "source": "provider-usage",
            },
        )

    def test_cost_does_not_report_estimates_as_actual(self):
        row = {
            "cost_status": "estimated",
            "actual_cost_usd": 4.5,
            "cost_source": "local-price-table",
        }

        self.assertEqual(
            self.api._cost(row, None),
            {"status": "estimated", "actual_cost_usd": None},
        )

    def test_cost_reports_included_unknown_and_missing_values(self):
        cases = (
            (
                {"cost_status": "included", "actual_cost_usd": 9.0},
                None,
                {"status": "included", "actual_cost_usd": 0.0},
            ),
            (
                {"cost_status": "unknown"},
                None,
                {"status": "unknown", "actual_cost_usd": None},
            ),
            (None, None, {"status": "unknown", "actual_cost_usd": None}),
            (
                None,
                "the session database is unavailable",
                {
                    "status": "unknown",
                    "actual_cost_usd": None,
                    "reason": "the session database is unavailable",
                },
            ),
        )

        for row, error, expected in cases:
            with self.subTest(row=row, error=error):
                self.assertEqual(self.api._cost(row, error), expected)

    def test_cost_rejects_invalid_actual_values(self):
        invalid_values = ("not-a-number", -2.0, float("nan"), float("inf"))

        for value in invalid_values:
            with self.subTest(value=value):
                result = self.api._cost(
                    {"cost_status": "actual", "actual_cost_usd": value},
                    None,
                )

                self.assertEqual(result["status"], "unknown")
                self.assertIsNone(result["actual_cost_usd"])
                self.assertIn("reason", result)

    def test_cost_normalizes_an_unsupported_status_to_unknown(self):
        self.assertEqual(
            self.api._cost(
                {"cost_status": {"unexpected": True}, "actual_cost_usd": 2.0},
                None,
            ),
            {"status": "unknown", "actual_cost_usd": None},
        )

    def test_session_metadata_reports_all_display_fields(self):
        row = {
            "cwd": "C:/work/example",
            "git_branch": "feature/status-tape",
            "model": "fallback-model",
            "billing_provider": "fallback-provider",
            "model_config": json.dumps(
                {
                    "model": "qwen3.6-35b-a3b-mtp",
                    "provider": "lm-studio",
                    "reasoning_config": {"enabled": True, "effort": "high"},
                    "service_tier": "priority",
                }
            ),
        }

        self.assertEqual(
            self.api._session_metadata(row, None),
            {
                "status": "ok",
                "cwd": "C:/work/example",
                "git_branch": "feature/status-tape",
                "model": "qwen3.6-35b-a3b-mtp",
                "provider": "lm-studio",
                "reasoning_effort": "high",
                "fast": True,
            },
        )

    def test_session_metadata_marks_disabled_reasoning(self):
        row = {
            "model_config": {
                "model": "example-model",
                "reasoning_config": {"enabled": False, "effort": "high"},
                "service_tier": "standard",
            }
        }

        result = self.api._session_metadata(row, None)

        self.assertEqual(result["reasoning_effort"], "none")
        self.assertFalse(result["fast"])

    def test_session_metadata_falls_back_from_malformed_model_config(self):
        malformed_values = ("{not-json", ["not", "a", "mapping"])

        for value in malformed_values:
            with self.subTest(value=value):
                result = self.api._session_metadata(
                    {
                        "cwd": None,
                        "git_branch": None,
                        "model": "row-model",
                        "billing_provider": "row-provider",
                        "model_config": value,
                    },
                    None,
                )

                self.assertEqual(
                    result,
                    {
                        "status": "ok",
                        "cwd": "",
                        "git_branch": "",
                        "model": "row-model",
                        "provider": "row-provider",
                        "reasoning_effort": "",
                        "fast": False,
                    },
                )

    def test_session_metadata_reports_missing_and_database_errors(self):
        self.assertEqual(
            self.api._session_metadata(None, None),
            {"status": "unavailable"},
        )
        self.assertEqual(
            self.api._session_metadata(None, "database error"),
            {"status": "unavailable", "reason": "database error"},
        )

    def test_session_row_does_not_open_the_database_without_an_id(self):
        database_class = Mock()
        with patch.object(self.api, "SessionDB", database_class):
            self.assertEqual(self.api._session_row(None), (None, None))
            self.assertEqual(self.api._session_row(""), (None, None))

        database_class.assert_not_called()

    def test_session_row_passes_the_id_as_data_and_closes_the_database(self):
        session_id = "../session?id=' OR 1=1 --"
        database = Mock()
        cursor = Mock()
        cursor.fetchone.return_value = {
            "model": "example-model",
            "model_config": "{}",
        }
        database._conn.execute.return_value = cursor
        database_class = Mock(return_value=database)

        with patch.object(self.api, "SessionDB", database_class):
            result = self.api._session_row(session_id)

        self.assertEqual(
            result, ({"model": "example-model", "model_config": "{}"}, None)
        )
        database_class.assert_called_once_with(read_only=True)
        query, parameters = database._conn.execute.call_args.args
        normalized_query = " ".join(query.split()).lower()
        self.assertIn("from sessions", normalized_query)
        self.assertNotIn("system_prompt", normalized_query)
        self.assertNotIn("messages", normalized_query)
        self.assertNotIn("select *", normalized_query)
        self.assertNotIn("s.*", normalized_query)
        self.assertEqual(parameters, (session_id,))
        database.close.assert_called_once_with()

    def test_session_row_closes_the_database_when_the_read_fails(self):
        database = Mock()
        database._conn.execute.side_effect = RuntimeError("read failed")

        with patch.object(self.api, "SessionDB", Mock(return_value=database)):
            row, error = self.api._session_row("session-1")

        self.assertIsNone(row)
        self.assertEqual(error, "read failed")
        database.close.assert_called_once_with()

    def test_telemetry_is_a_sync_route_with_the_stable_contract(self):
        resources = {
            "ram": {"status": "ok", "source": "psutil"},
            "vram": {"status": "unavailable", "source": "nvidia-smi", "devices": []},
        }
        cost = {"status": "actual", "actual_cost_usd": 1.25}
        session = {"status": "ok", "model": "example"}
        row = {"id": "session-1"}

        with (
            patch.object(self.api, "_hardware_resources", return_value=resources),
            patch.object(
                self.api, "_session_row", return_value=(row, None)
            ) as read_session,
            patch.object(self.api, "_cost", return_value=cost) as read_cost,
            patch.object(
                self.api, "_session_metadata", return_value=session
            ) as read_metadata,
            patch.object(self.api.time, "time", return_value=12.345),
        ):
            result = self.api.telemetry("session-1")

        routes = [
            route for route in self.api.router.routes if route.path == "/telemetry"
        ]
        self.assertEqual(len(routes), 1)
        self.assertFalse(inspect.iscoroutinefunction(routes[0].endpoint))
        self.assertEqual(
            result,
            {
                "schema_version": 1,
                "sampled_at_unix_ms": 12345,
                "resources": resources,
                "cost": cost,
                "session": session,
            },
        )
        read_session.assert_called_once_with("session-1")
        read_cost.assert_called_once_with(row, None)
        read_metadata.assert_called_once_with(row, None)


if __name__ == "__main__":
    unittest.main()

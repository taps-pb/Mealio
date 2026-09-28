import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

module_path = Path(__file__).with_name("prepare-indb.py")
spec = importlib.util.spec_from_file_location("prepare_indb", module_path)
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


def row(code="T1"):
    return {"sourceId": code, "name": "Test recipe", "kcalPer100g": 100.0,
            "proteinPer100g": 5.0, "carbsPer100g": 10.0, "servingUnit": "bowl",
            "servingKcal": 150.0, "servingProtein": 7.5, "servingCarbs": 15.0}


class AuditTests(unittest.TestCase):
    def test_valid_and_missing_serving(self):
        missing = {**row("T2"), "servingUnit": "", "servingKcal": None,
                   "servingProtein": None, "servingCarbs": None}
        records, report = prepare.audit_rows([row(), missing])
        self.assertEqual(report["valid"], 2)
        self.assertEqual(report["missing_servings"], 1)
        self.assertIsNone(records[1]["servingUnit"])

    def test_invalid_rows_and_duplicates(self):
        invalid = {**row("T3"), "proteinPer100g": float("nan")}
        partial = {**row("T4"), "servingKcal": None}
        records, report = prepare.audit_rows([row(), row(), invalid, partial, {**row("T5"), "name": ""}])
        self.assertEqual(len(records), 2)
        self.assertEqual(report["duplicate_codes"], 1)
        self.assertEqual(report["invalid_nutrients"], 1)
        self.assertEqual(report["partial_servings"], 1)
        self.assertEqual(report["missing_name_or_code"], 1)
        self.assertIsNone(records[1]["servingUnit"])

    def test_unusual_serving_weights_are_advisory(self):
        records, report = prepare.audit_rows([{**row(), "servingKcal": 900}])
        self.assertEqual(len(records), 1)
        self.assertEqual(report["unusual_serving_weights"], 1)

    def test_ambiguous_aliases_are_counted_without_selecting_a_recipe(self):
        _, report = prepare.audit_rows([row("T1"), row("T2")])
        self.assertEqual(report["ambiguous_dish_aliases"], 1)

    def test_rejects_export_outside_dataset(self):
        with self.assertRaises(ValueError):
            prepare.export_path("README.json")
        with self.assertRaises(ValueError):
            prepare.export_path("dataset/../README.json")
        self.assertEqual(prepare.export_path("dataset/local.json"), prepare.DATASET / "local.json")

    def test_export_requires_rights_confirmation(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            prepare.main(["--export", "dataset/local.json"])

    def test_private_export_is_explicit_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(prepare, "ROOT", root), patch.object(prepare, "DATASET", root / "dataset"), \
                    patch.object(prepare, "load_rows", return_value=[row()]):
                args = ["--workbook", str(module_path), "--export", "dataset/private.json", "--confirm-rights"]
                with redirect_stdout(io.StringIO()):
                    prepare.main(args)
                output = root / "dataset" / "private.json"
                self.assertEqual(json.loads(output.read_text())[0]["sourceId"], "T1")
                self.assertEqual(os.stat(output).st_mode & 0o777, 0o600)
                with redirect_stdout(io.StringIO()), self.assertRaises(FileExistsError):
                    prepare.main(args)


if __name__ == "__main__":
    unittest.main()

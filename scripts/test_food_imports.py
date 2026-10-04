"""Synthetic importer contracts; no HTTP calls or private nutrition records."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

def module(filename):
    spec=importlib.util.spec_from_file_location(filename,Path(__file__).with_name(filename+".py"))
    imported=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(imported)
    return imported

usda=module("import-usda")
off=module("import-openfoodfacts")

class FoodImportTests(unittest.TestCase):
    def test_off_stream_selects_exact_products_preserves_basis_and_discards_bulk_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/"dump.jsonl.gz"
            records=[{"code":"123", "product_name":"Synthetic beverage", "nutrition_data_per":"100ml", "quantity":"180 ml",
                "countries_tags":["en:india"], "nutriments":{"energy-kcal_100g":40}, "images":{"huge":"not retained"}},
                {"code":"999", "product_name":"Unselected"}]
            with gzip.open(path,"wt") as stream:
                for record in records: stream.write(json.dumps(record)+"\n")
            selected={"retrieved":"2026-10-04", "off":{"123":{}}}
            first=off.import_dump(path,selected)
            self.assertEqual(first,off.import_dump(path,selected))
            self.assertEqual(first["source"]["recordsImported"],1)
            self.assertEqual(first["products"][0]["nutrition_data_per"],"100ml")
            self.assertNotIn("images",first["products"][0])
            self.assertEqual(first["source"]["sha256"],hashlib.sha256(path.read_bytes()).hexdigest())
            with self.assertRaises(ValueError): off.import_dump(path,{"retrieved":"2026-10-04","off":{"missing":{}}})

    def test_usda_retains_selected_nutrients_portions_and_source_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/"data").mkdir()
            (root/"data/selection.json").write_text(json.dumps({"retrieved":"2026-10-04","usda":{"123":["test food"]}}))
            record={"fdcId":123,"description":"Synthetic FNDDS food", "foodNutrients":[
                {"nutrient":{"id":i},"amount":value} for i,value in [(1008,100),(1003,3),(1005,10),(1004,5),(1079,2),(2000,1),(1093,50)]],
                "foodPortions":[{"portionDescription":"1 cup","gramWeight":150}],"wweiaFoodCategory":{"wweiaFoodCategoryDescription":"test"}}
            archive=root/"source.zip"
            with zipfile.ZipFile(archive,"w") as target:target.writestr("survey.json",json.dumps({"SurveyFoods":[record,{**record,"fdcId":456}]}))
            with patch.object(usda,"ROOT",root):
                first=usda.extract([archive]);self.assertEqual(first,usda.extract([archive]))
                self.assertEqual(len(first["records"]),1)
                self.assertEqual(first["records"][0]["nutrition"]["sodium"],50)
                self.assertEqual(first["records"][0]["portions"][0]["grams"],150)
                self.assertEqual(first["sources"][0]["recordsImported"],1)
                self.assertEqual(first["records"][0]["sourceId"],"123")
                (root/"data/selection.json").write_text(json.dumps({"retrieved":"2026-10-04","usda":{"missing":["food"]}}))
                with self.assertRaises(ValueError):usda.extract([archive])

if __name__=="__main__": unittest.main()

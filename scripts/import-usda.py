"""Build-time extraction from official FDC JSON ZIPs; no runtime USDA client."""
import hashlib
import json
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]

def extract(paths):
    selection = json.loads((ROOT / "data/selection.json").read_text())
    chosen = selection["usda"]
    foods, sources = [], []
    for path in paths:
        raw = pathlib.Path(path).read_bytes()
        archive = zipfile.ZipFile(path)
        members = [name for name in archive.namelist() if name.endswith(".json")]
        if len(members) != 1:
            raise ValueError("Expected one USDA JSON artifact")
        records = next(iter(json.loads(archive.read(members[0])).values()))
        survey = "SurveyFoods" in json.loads(archive.read(members[0]))
        source = "usda-fndds" if survey else "usda-sr"
        imported = []
        for f in records:
            if str(f["fdcId"]) not in chosen:
                continue
            nutrients = {n["nutrient"]["id"]: n.get("amount") for n in f.get("foodNutrients", [])}
            values = {k: nutrients.get(n) for k, n in [("kcal",1008),("protein",1003),("carbs",1005),("fat",1004),("fiber",1079),("sugar",2000),("sodium",1093)]}
            if any(values[k] is None for k in ["kcal", "protein", "carbs", "fat"]):
                raise ValueError(f"Missing nutrient for {f['fdcId']}")
            imported.append({"id":f"usda-{f['fdcId']}", "sourceId":str(f["fdcId"]), "source":source,
                "description":f["description"], "aliases":chosen[str(f["fdcId"])], "nutrition":values,
                "category":f.get("wweiaFoodCategory", {}).get("wweiaFoodCategoryDescription", f.get("foodCategory", {}).get("description", "ingredient")),
                "portions":[{"name":p.get("portionDescription", p.get("modifier", "")), "grams":p["gramWeight"], "quantity":p.get("amount", 1)} for p in f.get("foodPortions", []) if p.get("gramWeight", 0)>0]})
        filename = "FoodData_Central_survey_food_json_2024-10-31.zip" if survey else "FoodData_Central_sr_legacy_food_json_2018-04.zip"
        sources.append({"id":source,"name":"USDA FNDDS" if survey else "USDA SR Legacy","version":"2021-2023 (2024-10-31)" if survey else "2018-04",
            "url":"https://fdc.nal.usda.gov/fdc-datasets/"+filename,"license":"CC0-1.0","licenseUrl":"https://fdc.nal.usda.gov/",
            "retrieved":selection["retrieved"],"transformation":"scripts/import-usda.py","recordsImported":len(imported),"sha256":hashlib.sha256(raw).hexdigest(),"rawBytes":len(raw)})
        foods.extend(imported)
    missing = set(chosen) - {f["sourceId"] for f in foods}
    if missing:
        raise ValueError(f"Selected IDs absent: {sorted(missing)}")
    return {"sources":sources,"records":sorted(foods,key=lambda f:f["id"])}

if __name__ == "__main__":
    result = extract(sys.argv[1:] or [ROOT / "data/raw/fndds.zip", ROOT / "data/raw/sr.zip"])
    (ROOT / "data/normalized/usda.json").write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n")
    print("USDA imported:",len(result["records"]))

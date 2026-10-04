"""Stream an OFF JSONL(.gz) dump, retaining only selected Indian/relevant products.

For small reviewed seed snapshots --seed downloads only the explicitly selected
barcodes at build time. Estimation never imports this tool. For full refreshes
prefer the official bulk export; no pagination or product discovery scraping.
"""
import gzip
import hashlib
import json
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIELDS = "code,product_name,brands,quantity,serving_size,countries_tags,nutriments,nutrition_data_per,last_modified_t,product_quantity,product_quantity_unit"

def import_dump(path, selection):
    digest=hashlib.sha256(); size=0
    with open(path,"rb") as stream:
        for chunk in iter(lambda:stream.read(1024*1024), b""):
            digest.update(chunk);size+=len(chunk)
    opener=gzip.open if str(path).endswith(".gz") else open
    selected={}
    with opener(path,"rt",encoding="utf-8") as stream:
        for line in stream:
            product=json.loads(line)
            code=str(product.get("code",product.get("_id","")))
            if code in selection["off"]:
                selected[code]={key:product.get(key) for key in FIELDS.split(",")}
    missing=set(selection["off"])-set(selected)
    if missing:
        raise ValueError("Selected products absent from artifact: "+", ".join(sorted(missing)))
    return {"source":{"id":"off","name":"Open Food Facts","version":selection["retrieved"]+" reviewed subset",
        "url":"https://world.openfoodfacts.org/data","license":"ODbL-1.0 / DbCL-1.0",
        "licenseUrl":"https://opendatacommons.org/licenses/odbl/1-0/","retrieved":selection["retrieved"],
        "transformation":"scripts/import-openfoodfacts.py","recordsImported":len(selected),"sha256":digest.hexdigest(),"rawBytes":size},
        "products":[selected[code] for code in sorted(selected)]}

if __name__ == "__main__":
    selection=json.loads((ROOT/"data/selection.json").read_text())
    path=ROOT/"data/raw/off-seed.jsonl"
    if "--seed" in sys.argv:
        products=[]
        for code in selection["off"]:
            url=f"https://world.openfoodfacts.org/api/v2/product/{code}.json?fields={FIELDS}"
            request=urllib.request.Request(url,headers={"User-Agent":"MealioOfflineBuild/1.0 (github.com/taps-pb/Mealio)"})
            with urllib.request.urlopen(request,timeout=60) as response:
                envelope=json.load(response)
            if envelope.get("status") != 1: raise ValueError("Selected product not found: "+code)
            products.append(envelope["product"])
        path.write_text("".join(json.dumps(p,ensure_ascii=False)+"\n" for p in products))
    elif len(sys.argv)>1: path=pathlib.Path(sys.argv[1])
    result=import_dump(path,selection)
    (ROOT/"data/normalized/openfoodfacts.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print("OFF imported:",len(result["products"]))

# Mealio local nutrition database

- **USDA FoodData Central**: FNDDS 2021–2023 (October 2024 release) and SR Legacy
  April 2018. Public domain, CC0. https://fdc.nal.usda.gov/
- **Open Food Facts contributors**: India/relevant-brand subset, retrieved
  2026-10-04. Database licensed under ODbL 1.0; individual contents under DbCL
  1.0. https://world.openfoodfacts.org/data
  https://opendatacommons.org/licenses/odbl/1-0/
  https://opendatacommons.org/licenses/dbcl/1-0/
  Mealio selects records, normalizes names/basis, adds aliases/portion mappings,
  removes unused metadata and quarantines invalid nutrients. Explicit packaging-
  label reviews may supersede inconsistent API values; their image URL, checksum,
  reviewed facts and reason are recorded in the manifest. No product images
  are included. The adapted layer is freely downloadable as
  `/nutrition/openfoodfacts.json`; the complete aggregate including portions is
  `/nutrition/catalog.json`. The OFF-derived database layer remains ODbL;
  attribution and share-alike obligations apply on redistribution/public use.
- **Mealio recipe definitions and portion assumptions**: original definitions
  dedicated under CC0 1.0. https://creativecommons.org/publicdomain/zero/1.0/
  This does not override licenses of the ingredient-source databases. Values are
  recipe calculations, not clinically measured values for an owner's cooking.
- **Subway India**: four factual nutrition references from the August 2026
  official nutrition chart. https://subway.in/nutrition-allergen-info
  Original document retains its copyright; no open license for the document is
  asserted. Document/images are not redistributed.
- **Coca-Cola India**: factual Sprite nutrition table, retrieved 2026-10-04.
  https://www.coca-cola.com/in/en/brands/sprite
  Original site retains its copyright; no open license for it is asserted.

Source URLs, versions, checksums, retrieval dates, import scripts and actual
record counts are in `/nutrition/manifest.json`. Build scripts and reviewed
normalized inputs are in the Mealio repository. No Sangat, INDB or IFCT content
is included. Custom foods/corrections belong to the owner and are never added to
these downloadable public artifacts.

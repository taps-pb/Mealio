import LibraryShell from "@/components/library/LibraryShell";
import { foodCatalog } from "@/lib/nutrition/runtime";
import styles from "@/components/library/Library.module.css";

export default function Page() {
  return <LibraryShell title="Data sources & licenses" subtitle="The references behind your local estimates." back="/about" backLabel="About Mealio">
    <div className={styles.sources}>
      <section><h2>Open Food Facts</h2><p>Contains data from <a href="https://world.openfoodfacts.org/">Open Food Facts</a>, available under the <a href="https://opendatacommons.org/licenses/odbl/1-0/">Open Database License</a> (ODbL 1.0); individual contents under <a href="https://opendatacommons.org/licenses/dbcl/1-0/">DbCL 1.0</a>. Attribution and share-alike obligations apply to the adapted product database.</p></section>
      <section><h2>USDA &amp; Mealio recipes</h2><p><a href="https://fdc.nal.usda.gov/">USDA FoodData Central</a> FNDDS and SR Legacy data are public domain / <a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0</a>. Mealio recipe definitions and serving assumptions are also dedicated under CC0. Recipes describe reference preparations; actual ingredients and portions may differ.</p></section>
      <section><h2>Restaurant &amp; manufacturer labels</h2><p>Subway and Sprite entries use cited official nutrition facts. Original label images and manufacturer documents are not redistributed.</p><ul>{foodCatalog.sources.filter((source) => source.id === "subway-in" || source.id === "coca-cola-in").map((source) => <li key={source.id}><a href={source.url}>{source.name}</a></li>)}</ul></section>
      <section><h2>Downloads &amp; full attribution</h2><ul><li><a href="/nutrition/openfoodfacts.json" download>Download adapted product database</a></li><li><a href="/nutrition/catalog.json" download>Full local database</a></li><li><a href="/nutrition/manifest.json" download>Source manifest</a></li><li><a href="/nutrition/ATTRIBUTION.md">Full attribution &amp; redistribution information</a></li></ul></section>
      <p>Database version {foodCatalog.version}. Food resolution and calculations run on this device without a nutrition API.</p>
    </div>
  </LibraryShell>;
}

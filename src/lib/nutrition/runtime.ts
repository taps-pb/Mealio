import catalogJson from "../../../public/nutrition/catalog.json";
import { NutritionEngine } from "./engine";
import type { Catalog, UserData } from "./types";

// Static import: included in the app bundle, never fetched while estimating.
export const foodCatalog = catalogJson as Catalog;
export const createNutritionEngine = (user?: UserData) => new NutritionEngine(foodCatalog, user);

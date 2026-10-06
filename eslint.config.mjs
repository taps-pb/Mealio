import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  { ignores: [".next/**", "node_modules/**", "out/**", "drizzle/**", "data/raw/**", "public/nutrition/sw.js", "test-results/**", "playwright-report/**"] },
];

export default eslintConfig;

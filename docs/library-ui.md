# Dedicated local library UI

## Screens

- `/`: authenticated journal; Add Meal starts with a short description input,
  Estimate, a quiet offline/library row, manual-entry disclosure and compact time.
  Successful estimation opens a calorie-led summary and Save directly. Manual
  nutrition, item corrections and the date/time editor appear only when opened.
- `/foods`: separate Foods and Recipes lists, with named Delete confirmations.
- `/foods/new`: label-based custom food form.
- `/foods/recipes/new`: ingredient rows, cooked yield, servings and a preview of
  total/per-serving nutrition. Cooked yield remains required by the existing model.
- `/foods/details?id=…`: saved food or recipe details, including recipe ingredients.
- `/foods/settings`: export, confirmed import/reset, reviewed-correction import
  and removable remembered interpretations.
- `/about` → `/about/sources`: original attribution/downloads and official sources.

## State and calculation boundaries

The catalog, food parser, resolver, recipe calculations and `UserLibrary` format
are unchanged. `useLocalLibrary` adapts the existing storage service for the new
screens. Recipe ingredient rows produce the same newline-separated input for
the existing engine; previews reuse its totals and scaling helper. Definitions
are created/deleted with the existing library functions and validated on save.
Foods used by another saved recipe still cannot be deleted.

Secondary screens use ordinary document links. This makes cached HTML navigation
work offline without requesting Next.js server-component data. The generated
worker is root-scoped but only handles explicitly allowlisted public pages/assets;
private journal HTML and all APIs are excluded. The previous `/nutrition` worker
registration is retired when the new public shell is installed.

Tab-local session storage preserves the current meal draft (including reviewed
item snapshots, manual macro overrides, save key and original timestamp), editor
drafts and temporary interpretations across document navigation and refresh.
The original local-library key remains `mealio-food-library-v1:owner`. No food
migration or historical meal update is performed by this UI refactor. Back/forward
cache revisits reload local storage state. Storage failure blocks the library link
from the current meal rather than discarding an unpreserved draft.

Library deletion/reset does not modify logged meals. Confirmations use native
modal dialogs with keyboard cancellation and focus handling. Editing existing
definitions is not introduced; list actions provide Delete and a detail view.

## Minimal meal entry

The normal Add Meal surface has no enclosing card, introductory text, visible
description label or empty macro form. The textarea retains an accessible label
and grows from two lines. Manual fields can be hidden without erasing values;
Review appears only with a description and complete required totals. Estimation
shows a pending button, prevents duplicate runs and then enters the existing
review/save state. The save API, validation, correction rules, numeric precision
and idempotency behavior are retained. Only the displayed date label is shortened;
the existing device-local input and exact original instant handling are unchanged.

`e2e/minimal-entry.spec.ts` records the four 390px states and verifies direct
estimate/save, disclosure, pending/error recovery, remembered portions, precision
and saved timestamp preservation. Library, standalone/offline and responsive
tests continue to exercise the separate screens.

## Local verification

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, then
`npm run test:browser`. The browser suite uses synthetic journal APIs and tests:

- Compact Add Meal, real route transitions, back/forward, draft refresh and the
  original review/save/history flow with manual totals and timestamps retained.
- Offline food/recipe creation, refresh, real browser restart, ingredient
  resolution, exact custom-food macros, cooked yield and per-serving calculations.
- Delete cancellation/confirmation, recipe dependency errors, export/import,
  invalid-backup retention, reset confirmation and all attribution links.
- 360/390/412 px layouts in light and dark modes, long names, input containment
  and final save/review controls remaining above bottom navigation.
- Offline cache inspection confirming no journal HTML or API responses are stored.

Mobile screenshots are written under ignored `test-results/`. The database and
catalog artifacts retain their prior versions and checksums. Phone approval and
publication are separate from these local checks.

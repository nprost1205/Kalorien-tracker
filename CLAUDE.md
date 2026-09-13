# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Kalorien- und Nährstoff-Tracker als rein statische Web-App (UI komplett auf Deutsch). Kein Build, keine Abhängigkeiten, kein Server: Der Nutzer öffnet `index.html` per Doppelklick in Edge/Chrome (`file://`). Auf dem Rechner sind weder Node.js noch Python installiert.

## Deployment (Handy)

- The user also runs the app on an **Android phone** as an installable PWA hosted on **GitHub Pages** (user-owned account; git is not installed, files are uploaded via the GitHub web UI, served under `https://<user>.github.io/kalorien-tracker/`). There is no sync: each device keeps its own localStorage, data moves via the backup export/import (on the phone also via "Backup teilen", which uses the Web Share API with a `.txt` file because Chrome doesn't allow sharing `.json`).
- PWA files: `manifest.webmanifest`, `sw.js`, `icons/`. The manifest `<link>` is injected and the service worker registered **only over http(s)**, so `file://` on the PC keeps working without console errors. All paths are relative (the app lives in a subpath on Pages).
- `sw.js` is network-first (3 s timeout, `cache: 'no-cache'`) with cache fallback, same-origin GET only. **When adding/renaming app files, update `ASSETS` and bump `CACHE`** (`kalorien-tracker-vN`). After any change the user must re-upload the changed files to GitHub.

## Running / testing

- Run: open `index.html` in the browser. There are no build, lint, or test commands.
- The Claude browser pane renders `file://` pages only as static snapshots (no CSS/JS), so serve the folder over HTTP for testing, e.g. a PowerShell `System.Net.HttpListener` script started via `.claude/launch.json` (no Python/Node available). Remember that `localhost` has its own localStorage, separate from the user's `file://` data. To test the PWA like on Pages, serve the folder under `/kalorien-tracker/`; afterwards unregister the service workers and delete the caches in the test browser so later tests aren't served stale files.

## Constraints

- `app.js` must stay a classic `<script>`: ES modules and `fetch` of local files are blocked under `file://`.
- No external libraries/CDNs; everything except the product search must work offline (the chart is hand-built SVG).
- Only Open Food Facts is contacted over the network. It sends `Access-Control-Allow-Origin: *`, which is why requests from origin `null` work. Search is triggered only by button/Enter, never while typing (OFF rate limit ≈10 searches/min).

## Architecture (`app.js`)

- `NUTRIENTS` is the single source for nutrient keys, labels, units, decimals, `kind` (`max` = limit, shown red when exceeded; `min` = target, ✓ when reached) and the OFF field name. Goal forms and manual-entry inputs are generated from it, so a new nutrient only needs to be added there (plus `DEFAULT_GOALS`). Tracked nutrients: kcal, protein, carbs, fat, fiber. Sugar and salt were removed completely at the user's request; `normalizePer100()` / `normalizeState()` drop their values from older data and backups.
- State lives in localStorage under `kalorienTracker.v1`: `{ version, goals, foods, recipes, diary, activities }`. `recipes`, `recipe.instructions` and `activities` were added later without a version bump; `normalizeState()` fills defaults for older data/backups (and drops unknown keys, e.g. an `ai` object left over from a removed AI feature), so new fields must be added there. `diary` is keyed by local-date strings `YYYY-MM-DD` (built with `dateKey()`, never `toISOString`, to avoid time-zone shifts).
- Sport: `activities` is keyed by date like `diary` (`[{ id, name, kcal }]`). Burned kcal (`burnedKcal(key)`) raise **only the kcal goal** of that day (not macros): the day summary, bar colors and the stepped goal line in the history chart, and the averaged kcal goal all use `goals.kcal + burned`. Days count as "logged" for averages only if they have food entries.
- Diary entries store a **copy** of `per100` nutrient values, so they stay correct when a product is removed from `foods` (which only feeds the "Zuletzt verwendet" list).
- Recipes (`{ id, name, servings, totalWeight|null, ingredients[] }`) store ingredients in the same item shape as diary entries (`normalizeItem()`, rendered by `itemRow()`). `recipeStats()` derives totals, per-serving and per-100 g values (per 100 g uses `totalWeight` if set, else the ingredient sum). `recipeAsFood()` turns a recipe into a food object (`isRecipe: true`, `servingG` = one portion) so the add dialog handles it like a product. Logging a recipe snapshots its current `per100`, so later recipe edits don't change past days. Recipes are not added to `foods`.
- The add dialog serves two targets (`dialogTarget`): `'diary'` logs an entry, `'recipe'` appends an ingredient to `recipeDraft` (the in-memory working copy of the recipe editor, only persisted on "Rezept speichern"). Open it via `openDialog({ target, title, meal, food })`.
- In the recipe editor, ✎ opens an inline form to edit an ingredient's name and per-100 g values (`ingredientEditor()` / `applyIngredientEdit()`), and `nutrientsPlausible()` marks ingredients (⚠) whose kcal don't match the macros. Enter inside ingredient inputs is intercepted so it doesn't submit (save) the whole recipe form.
- An AI recipe generator (local Ollama) was built and then removed at the user's request — don't re-add it unasked.
- Nutrient values may be `null` (unknown, shown as "–", counted as 0); `kcal` is always required.
- `normalizeState()` validates and cleans both localStorage data on load and imported backups. Corrupt stored data is copied to `kalorienTracker.v1.defekt-<timestamp>` instead of being overwritten.
- All totals go through `calcNutrients()` / `sumEntries()` (day view, dialog preview, history).
- Rendering uses template strings + `innerHTML`; always pass user/OFF text through `esc()`.
- Views (`day`, `history`, `recipes`, `goals`, `data`) are `<section id="view-…">` toggled by `showView()`, which calls the matching function in `RENDERERS`. Changes from another tab arrive via the `storage` event.

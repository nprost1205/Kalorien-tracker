'use strict';

// =====================================================================
// Konfiguration
// =====================================================================

const STORAGE_KEY = 'kalorienTracker.v1';

// kind: 'max' = Obergrenze (Überschreitung rot), 'min' = Mindestmenge (Erreichen ✓)
const NUTRIENTS = [
  { key: 'kcal',    label: 'Kalorien',      unit: 'kcal', decimals: 0, kind: 'max', off: 'energy-kcal_100g' },
  { key: 'protein', label: 'Eiweiß',        unit: 'g',    decimals: 1, kind: 'min', off: 'proteins_100g' },
  { key: 'carbs',   label: 'Kohlenhydrate', unit: 'g',    decimals: 1, kind: 'max', off: 'carbohydrates_100g' },
  { key: 'fat',     label: 'Fett',          unit: 'g',    decimals: 1, kind: 'max', off: 'fat_100g' },
  { key: 'fiber',   label: 'Ballaststoffe', unit: 'g',    decimals: 1, kind: 'min', off: 'fiber_100g' },
];
const NUT = Object.fromEntries(NUTRIENTS.map(n => [n.key, n]));

const MEALS = [
  { key: 'fruehstueck', label: 'Frühstück' },
  { key: 'mittag',      label: 'Mittagessen' },
  { key: 'abend',       label: 'Abendessen' },
  { key: 'snack',       label: 'Snacks' },
  { key: 'fueling',     label: 'Fueling' }, // Ernährung während dem Sport, wird in der Sport-Karte angezeigt
];

const DEFAULT_GOALS = { kcal: 2000, protein: 100, carbs: 250, fat: 70, fiber: 30 };

// Eigenschaften von Rezepten. Grenzwerte gelten pro Portion und werden im Editor anhand der Nährwerte geprüft.
const LOWCAL_MAX_KCAL = 500;
const HIGHPROTEIN_MIN_G = 30;
const HIGHCARB_MIN_G = 60;
const RECIPE_TAGS = [
  { key: 'vegan', label: 'vegan', icon: '🌱', prompt: 'vegan: keine tierischen Zutaten (kein Fleisch, kein Fisch, keine Eier, keine Milchprodukte, kein Honig)' },
  { key: 'vegetarian', label: 'vegetarisch', icon: '🥕', prompt: 'vegetarisch: kein Fleisch, kein Fisch, keine Meeresfrüchte' },
  { key: 'lowcal', label: 'kalorienarm', icon: '🪶', prompt: `kalorienarm: höchstens ${LOWCAL_MAX_KCAL} kcal pro Portion` },
  { key: 'highcarb', label: 'kohlenhydratreich', icon: '🍝', prompt: `kohlenhydratreich: mindestens ${HIGHCARB_MIN_G} g Kohlenhydrate pro Portion, z. B. mit Nudeln, Reis, Kartoffeln, Brot oder Haferflocken als Basis` },
  { key: 'highprotein', label: 'proteinreich', icon: '💪', prompt: `proteinreich: mindestens ${HIGHPROTEIN_MIN_G} g Eiweiß pro Portion` },
];
const TAG = Object.fromEntries(RECIPE_TAGS.map(t => [t.key, t]));

const OFF_BASE ='https://world.openfoodfacts.org';
const OFF_FIELDS = 'code,product_name,product_name_de,generic_name_de,brands,nutriments,serving_quantity';
const OFF_TIMEOUT_MS = 20000; // die Textsuche von Open Food Facts ist oft langsam

// =====================================================================
// Hilfsfunktionen
// =====================================================================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Zahl oder null (leere/ungültige Werte). Akzeptiert auch Komma als Dezimaltrenner. */
function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function isHttpUrl(v) {
  return /^https?:\/\/\S+$/i.test(String(v ?? '').trim());
}

function round(v, decimals = 2) {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

function fmt(v, decimals = 0) {
  return (Number(v) || 0).toLocaleString('de-DE', { maximumFractionDigits: decimals });
}

function fmtNut(key, v) {
  const n = NUT[key];
  return `${fmt(v, n.decimals)} ${n.unit}`;
}

function mealLabel(key) {
  return (MEALS.find(m => m.key === key) || MEALS[3]).label;
}

// ---------- Datum (immer lokale Zeit, nie toISOString) ----------

const pad = n => String(n).padStart(2, '0');

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

function today() {
  return dateKey(new Date());
}

function formatDateLabel(key) {
  const d = parseKey(key);
  const diff = Math.round((d - parseKey(today())) / 86400000);
  const rel = { '-1': 'Gestern', '0': 'Heute', '1': 'Morgen' }[diff];
  const opts = { weekday: 'long', day: 'numeric', month: 'long' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  const text = d.toLocaleDateString('de-DE', opts);
  return rel ? `${rel} · ${text}` : text;
}

function axisLabel(key, withWeekday) {
  const d = parseKey(key);
  const short = `${d.getDate()}.${d.getMonth() + 1}.`;
  return withWeekday ? `${d.toLocaleDateString('de-DE', { weekday: 'short' })} ${short}` : short;
}

// ---------- Nährwertberechnung (zentral für alle Ansichten) ----------

function zeroTotals() {
  return Object.fromEntries(NUTRIENTS.map(n => [n.key, 0]));
}

function calcNutrients(per100, grams) {
  const out = {};
  for (const n of NUTRIENTS) out[n.key] = (Number(per100?.[n.key]) || 0) * grams / 100;
  return out;
}

function sumEntries(entries) {
  const totals = zeroTotals();
  for (const e of entries) {
    const c = calcNutrients(e.per100, e.grams);
    for (const n of NUTRIENTS) totals[n.key] += c[n.key];
  }
  return totals;
}

/** Beim Sport verbrannte Kalorien eines Tages. */
function burnedKcal(key) {
  return (state.activities[key] || []).reduce((sum, a) => sum + a.kcal, 0);
}

const SPORT_KCAL_PER_G_CARBS = 4; // 4 kcal Sport → 1 g zusätzliche Kohlenhydrate

/** Sport-Zuschlag auf die Tagesziele: alle verbrannten kcal und die passenden Kohlenhydrate. */
function sportBonus(burned) {
  return { kcal: burned, carbs: burned / SPORT_KCAL_PER_G_CARBS };
}

/** Tagesziele eines Tages inklusive Sport (Grundziele + Zuschlag). */
function dayGoals(key) {
  const bonus = sportBonus(burnedKcal(key));
  return { ...state.goals, kcal: state.goals.kcal + bonus.kcal, carbs: state.goals.carbs + bonus.carbs };
}

/** Summen und abgeleitete Werte eines Rezepts (gesamt, pro Portion, pro 100 g). */
function recipeStats(recipe) {
  const totals = sumEntries(recipe.ingredients);
  const rawWeight = recipe.ingredients.reduce((sum, i) => sum + i.grams, 0);
  const weight = recipe.totalWeight > 0 ? recipe.totalWeight : rawWeight;
  const servings = recipe.servings > 0 ? recipe.servings : 1;
  const perServing = {};
  const per100 = {};
  for (const n of NUTRIENTS) {
    // Unbekannt („–“) nur, wenn keine einzige Zutat einen Wert dafür hat
    const known = n.key === 'kcal' || recipe.ingredients.some(i => i.per100[n.key] !== null);
    perServing[n.key] = known ? totals[n.key] / servings : null;
    per100[n.key] = known ? (weight > 0 ? round((totals[n.key] / weight) * 100) : 0) : null;
  }
  return { totals, rawWeight, weight, servings, servingG: weight / servings, perServing, per100 };
}

/** Rezept in der Form eines Lebensmittels, damit der Hinzufügen-Dialog es wie ein Produkt behandeln kann. */
function recipeAsFood(recipe) {
  const s = recipeStats(recipe);
  return { id: recipe.id, name: recipe.name, brand: 'Rezept', code: '', per100: s.per100, servingG: round(s.servingG, 1), isRecipe: true };
}

// =====================================================================
// Speicher
// =====================================================================

let storageWarning = '';

function defaultState() {
  return {
    version: 1, goals: { ...DEFAULT_GOALS }, foods: {}, recipes: {}, diary: {}, activities: {},
    shopping: [], shops: [], shopAssignments: {}, shopLocation: null, pantry: [], dislikes: [],
  };
}

function normalizePer100(p) {
  if (!isObj(p)) return null;
  const out = {};
  for (const n of NUTRIENTS) out[n.key] = toNum(p[n.key]);
  return out.kcal === null ? null : out;
}

function normalizeFood(f) {
  if (!isObj(f)) return null;
  const per100 = normalizePer100(f.per100);
  const name = String(f.name ?? '').trim();
  if (!per100 || !name) return null;
  const servingG = toNum(f.servingG);
  return {
    id: String(f.id),
    name,
    brand: String(f.brand ?? ''),
    code: f.code ? String(f.code) : '',
    per100,
    servingG: servingG > 0 ? servingG : null,
    lastUsed: toNum(f.lastUsed) || 0,
  };
}

/** Gemeinsame Form von Tagebucheinträgen und Rezeptzutaten. */
function normalizeItem(e) {
  if (!isObj(e)) return null;
  const per100 = normalizePer100(e.per100);
  const grams = toNum(e.grams);
  const name = String(e.name ?? '').trim();
  if (!per100 || grams === null || grams <= 0 || !name) return null;
  return {
    id: String(e.id || uid()),
    name,
    brand: String(e.brand ?? ''),
    code: e.code ? String(e.code) : '',
    grams,
    per100,
  };
}

function normalizeEntry(e) {
  const item = normalizeItem(e);
  return item && { ...item, meal: MEALS.some(m => m.key === e.meal) ? e.meal : 'snack' };
}

function normalizeRecipe(r) {
  if (!isObj(r)) return null;
  const name = String(r.name ?? '').trim();
  const ingredients = Array.isArray(r.ingredients) ? r.ingredients.map(normalizeItem).filter(Boolean) : [];
  if (!name || !ingredients.length) return null;
  const servings = toNum(r.servings);
  const totalWeight = toNum(r.totalWeight);
  return {
    id: String(r.id),
    name,
    servings: servings > 0 ? servings : 1,
    totalWeight: totalWeight > 0 ? totalWeight : null,
    ingredients,
    instructions: String(r.instructions ?? ''),
    sourceUrl: isHttpUrl(r.sourceUrl) ? String(r.sourceUrl).trim() : '',
    tags: normalizeTags(r.tags),
    updated: toNum(r.updated) || 0,
  };
}

/** Nur bekannte Eigenschaften, feste Reihenfolge; vegan schließt vegetarisch ein. */
function normalizeTags(tags) {
  const set = new Set(Array.isArray(tags) ? tags.map(String) : []);
  if (set.has('vegan')) set.add('vegetarian');
  return RECIPE_TAGS.map(t => t.key).filter(key => set.has(key));
}

function toggleTag(tags, key) {
  const set = new Set(tags);
  if (set.has(key)) {
    set.delete(key);
    if (key === 'vegetarian') set.delete('vegan'); // nicht vegetarisch → auch nicht vegan
  } else {
    set.add(key);
  }
  return normalizeTags([...set]);
}

function tagChips(selected, attr) {
  return RECIPE_TAGS.map(t => `
    <button type="button" class="tag-chip" data-${attr}="${t.key}" aria-pressed="${selected.includes(t.key)}">${t.icon} ${t.label}</button>`).join('');
}

function normalizeActivity(a) {
  if (!isObj(a)) return null;
  const kcal = toNum(a.kcal);
  if (kcal === null || kcal <= 0) return null;
  return { id: String(a.id || uid()), name: String(a.name ?? '').trim() || 'Sport', kcal: Math.round(kcal) };
}

/** Prüft und bereinigt geladene/importierte Daten. Wirft bei unbrauchbarem Format. */
function normalizeState(s) {
  if (!isObj(s) || s.version !== 1 || !isObj(s.diary)) {
    throw new Error('Die Datei enthält keine Daten des Kalorien-Trackers.');
  }
  const goals = { ...DEFAULT_GOALS };
  for (const key of Object.keys(DEFAULT_GOALS)) {
    const v = toNum(s.goals?.[key]);
    if (v !== null && v > 0) goals[key] = v;
  }
  const foods = {};
  for (const [id, f] of Object.entries(isObj(s.foods) ? s.foods : {})) {
    const food = normalizeFood({ ...f, id });
    if (food) foods[id] = food;
  }
  const recipes = {}; // fehlt in Backups vor der Rezept-Funktion
  for (const [id, r] of Object.entries(isObj(s.recipes) ? s.recipes : {})) {
    const recipe = normalizeRecipe({ ...r, id });
    if (recipe) recipes[id] = recipe;
  }
  const diary = {};
  for (const [key, entries] of Object.entries(s.diary)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Array.isArray(entries)) continue;
    const clean = entries.map(normalizeEntry).filter(Boolean);
    if (clean.length) diary[key] = clean;
  }
  const activities = {}; // fehlt in Backups vor der Sport-Funktion
  for (const [key, list] of Object.entries(isObj(s.activities) ? s.activities : {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Array.isArray(list)) continue;
    const clean = list.map(normalizeActivity).filter(Boolean);
    if (clean.length) activities[key] = clean;
  }
  // fehlt in Backups vor der Einkaufsliste
  // Märkte, gemerkte Zuordnungen und Standort: fehlen in Backups vor der Markt-Funktion
  const shops = (Array.isArray(s.shops) ? s.shops : []).map(normalizeShop).filter(Boolean);
  const shopIds = new Set(shops.map(shop => shop.id));
  const shopping = (Array.isArray(s.shopping) ? s.shopping : [])
    .map(normalizeShoppingItem)
    .filter(Boolean)
    .map(i => ({ ...i, shopId: shopIds.has(i.shopId) ? i.shopId : null }));
  const shopAssignments = {};
  for (const [key, id] of Object.entries(isObj(s.shopAssignments) ? s.shopAssignments : {})) {
    if (shopIds.has(String(id))) shopAssignments[key] = String(id);
  }
  const loc = isObj(s.shopLocation) ? s.shopLocation : null;
  const shopLocation = loc && toNum(loc.lat) !== null && toNum(loc.lon) !== null
    ? { label: String(loc.label ?? ''), lat: toNum(loc.lat), lon: toNum(loc.lon) }
    : null;
  const pantry = normalizeNameList(s.pantry); // fehlt in Backups vor der Vorrats-Funktion
  const dislikes = normalizeNameList(s.dislikes); // fehlt in Backups vor „Mag ich nicht“
  return { version: 1, goals, foods, recipes, diary, activities, shopping, shops, shopAssignments, shopLocation, pantry, dislikes };
}

/** Liste einfacher Namen (Vorrat, „Mag ich nicht“): ohne Leereinträge und Doppelte, auch ältere reine Text-Listen. */
function normalizeNameList(list) {
  const out = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const name = String((isObj(entry) ? entry.name : entry) ?? '').trim();
    if (name && !out.some(x => x.name.toLowerCase() === name.toLowerCase())) {
      out.push({ id: String((isObj(entry) && entry.id) || uid()), name });
    }
  }
  return out;
}

function normalizeShop(shop) {
  if (!isObj(shop)) return null;
  const name = String(shop.name ?? '').trim();
  if (!name) return null;
  return {
    id: String(shop.id || uid()),
    name,
    detail: String(shop.detail ?? '').trim(), // z. B. „Supermarkt · Hauptstraße 5“
    osm: shop.osm ? String(shop.osm) : '', // OpenStreetMap-ID, damit derselbe Markt nicht doppelt gespeichert wird
  };
}

function normalizeShoppingItem(i) {
  if (!isObj(i)) return null;
  const name = String(i.name ?? '').trim();
  if (!name) return null;
  const grams = toNum(i.grams);
  return {
    id: String(i.id || uid()),
    name,
    grams: grams > 0 ? grams : null, // null = Eintrag ohne Mengenangabe (z. B. von Hand „2 Eier“)
    sources: Array.isArray(i.sources) ? [...new Set(i.sources.map(String).filter(Boolean))] : [],
    checked: Boolean(i.checked),
    shopId: i.shopId ? String(i.shopId) : null,
  };
}

function loadState() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    storageWarning = 'Dieser Browser erlaubt keinen lokalen Speicher. Deine Einträge gehen beim Schließen verloren.';
    return defaultState();
  }
  if (!raw) return defaultState();
  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    // Beschädigte Daten nicht überschreiben, sondern unter eigenem Schlüssel aufheben
    try { localStorage.setItem(`${STORAGE_KEY}.defekt-${Date.now()}`, raw); } catch { /* ignorieren */ }
    storageWarning = 'Die gespeicherten Daten waren beschädigt. Sie wurden gesichert und die App startet leer. Du kannst ein Backup importieren.';
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    showToast(`Speichern fehlgeschlagen: ${e.message}`, true);
    return false;
  }
}

// =====================================================================
// Open Food Facts
// =====================================================================

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OFF_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.status === 404) return null;
    if (res.status === 429) throw new Error('Zu viele Suchanfragen. Bitte warte eine Minute.');
    if (res.status >= 500) throw new Error('Open Food Facts ist gerade überlastet. Bitte in ein paar Sekunden erneut suchen.');
    if (!res.ok) throw new Error(`Open Food Facts meldet einen Fehler (${res.status}). Bitte später erneut versuchen.`);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Zeitüberschreitung: Open Food Facts antwortet gerade nicht.');
    if (e instanceof TypeError) {
      throw new Error(navigator.onLine ? 'Verbindung zu Open Food Facts fehlgeschlagen.' : 'Keine Internetverbindung.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Wandelt ein OFF-Produkt in unser Format um; null, wenn Name oder Kalorien fehlen. */
function mapOffProduct(p) {
  if (!isObj(p)) return null;
  const n = isObj(p.nutriments) ? p.nutriments : {};
  const name = String(p.product_name_de || p.product_name || p.generic_name_de || '').trim();
  let kcal = toNum(n['energy-kcal_100g']);
  if (kcal === null) {
    const kj = toNum(n['energy-kj_100g']) ?? toNum(n.energy_100g); // energy_100g ist in kJ
    if (kj !== null) kcal = kj / 4.184;
  }
  if (!name || kcal === null || kcal < 0) return null;

  const per100 = {};
  for (const nut of NUTRIENTS) per100[nut.key] = nut.key === 'kcal' ? Math.round(kcal * 10) / 10 : toNum(n[nut.off]);
  const servingG = toNum(p.serving_quantity);
  return {
    id: `off-${p.code}`,
    code: String(p.code || ''),
    name,
    brand: String(p.brands || '').split(',')[0].trim(),
    per100,
    servingG: servingG > 0 ? servingG : null,
  };
}

async function offSearch(query) {
  if (/^\d{8,14}$/.test(query)) {
    const data = await fetchJson(`${OFF_BASE}/api/v2/product/${query}.json?fields=${OFF_FIELDS}`);
    const product = data && data.status === 1 ? mapOffProduct({ code: query, ...data.product }) : null;
    return product ? [product] : [];
  }
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '30',
    lc: 'de',
    fields: OFF_FIELDS,
  });
  const data = await fetchJson(`${OFF_BASE}/cgi/search.pl?${params}`);
  const seen = new Set();
  const results = [];
  for (const raw of data?.products || []) {
    const p = mapOffProduct(raw);
    if (p && p.code && !seen.has(p.id)) {
      seen.add(p.id);
      results.push(p);
    }
  }
  return results;
}

// =====================================================================
// App-Zustand
// =====================================================================

let state = loadState();
let currentView = 'day';
let currentDate = today();
let historyRange = 7;

const RENDERERS = {
  day: renderDay,
  history: renderHistory,
  recipes: renderRecipes,
  shopping: renderShopping,
  goals: renderGoals,
  data: renderData,
};

function showView(name) {
  currentView = name;
  $$('.tab').forEach(t => {
    const active = t.dataset.view === name;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  $$('.view').forEach(v => { v.hidden = v.id !== `view-${name}`; });
  RENDERERS[name]();
}

let toastTimer;
function showToast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 5000 : 2500);
}

function setMsg(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.hidden = !text;
}

// =====================================================================
// Ansicht: Tag
// =====================================================================

function renderDay() {
  $('#dateLabel').textContent = formatDateLabel(currentDate);
  $('#todayBtn').hidden = currentDate === today();
  const entries = state.diary[currentDate] || [];
  renderSummary(sumEntries(entries));
  renderMeals(entries);
  renderSport();
}

function progressRow(key, value, extraClass = '', goal = state.goals[key]) {
  const n = NUT[key];
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
  const status = n.kind === 'max' && value > goal ? 'over' : n.kind === 'min' && value >= goal ? 'reached' : '';
  const color = extraClass.includes('big') || ['protein', 'carbs', 'fat'].includes(key) ? `var(--c-${key})` : 'var(--c-extra)';
  return `
    <div class="prog ${extraClass} ${status}" style="--c:${color}">
      <div class="prog-head">
        <span class="prog-label">${esc(n.label)}</span>
        <span class="prog-val"><b>${fmt(value, n.decimals)}</b> / ${fmt(goal, n.decimals)} ${n.unit}</span>
      </div>
      <div class="bar" role="progressbar" aria-label="${esc(n.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}">
        <div class="bar-fill" style="width:${pct}%"></div>
      </div>
    </div>`;
}

function renderSummary(t) {
  const burned = burnedKcal(currentDate);
  const goals = dayGoals(currentDate);
  const rest = goals.kcal - t.kcal;
  const restText = rest >= 0 ? `Noch ${fmt(rest)} kcal übrig` : `${fmt(-rest)} kcal über dem Ziel`;
  const sportText = burned
    ? ` · <span class="sport-info">Ziel inkl. ${fmt(burned)} kcal Sport (${fmt(state.goals.kcal)} + ${fmt(burned)}), `
      + `dazu ${fmt(sportBonus(burned).carbs)} g Kohlenhydrate</span>`
    : '';
  $('#summary').innerHTML = `
    <div>
      ${progressRow('kcal', t.kcal, 'big', goals.kcal)}
      <div class="kcal-rest">${restText}${sportText}</div>
    </div>
    <div class="prog-grid">
      ${['protein', 'carbs', 'fat', 'fiber'].map(k => progressRow(k, t[k], '', goals[k])).join('')}
    </div>`;
}

function renderMeals(entries) {
  $('#meals').innerHTML = MEALS.filter(meal => meal.key !== 'fueling').map(meal => {
    const items = entries.filter(e => e.meal === meal.key);
    const kcal = sumEntries(items).kcal;
    return `
      <div class="card meal">
        <div class="meal-head">
          <h2>${esc(meal.label)}</h2>
          ${items.length ? `<span class="meal-kcal">${fmt(kcal)} kcal</span>` : ''}
          <button type="button" class="btn small" data-add="${meal.key}">+ Hinzufügen</button>
        </div>
        ${items.length ? `<ul class="entries">${items.map(e => itemRow(e)).join('')}</ul>` : ''}
      </div>`;
  }).join('');
}

/** Zeile für einen Tagebucheintrag bzw. mit prefix 'ing-' für eine Rezeptzutat. */
function itemRow(e, prefix = '') {
  const c = calcNutrients(e.per100, e.grams);
  const what = prefix ? 'Zutat' : 'Eintrag';
  const missing = e.per100.kcal === null; // nur bei Zutaten aus einem eingefügten Text möglich
  return `
    <li class="entry${missing ? ' missing' : ''}" data-id="${esc(e.id)}">
      <div class="entry-main">
        <div class="entry-name">${esc(e.name)}${e.brand ? ` <span class="muted">· ${esc(e.brand)}</span>` : ''}</div>
        <div class="entry-macros muted">${missing
          ? '<span class="missing-text">Nährwerte fehlen</span>'
          : `E ${fmt(c.protein, 1)} g · K ${fmt(c.carbs, 1)} g · F ${fmt(c.fat, 1)} g`}</div>
      </div>
      <label class="grams"><input type="number" min="0" step="any" value="${e.grams}" data-${prefix}grams aria-label="Menge in Gramm"> g</label>
      <div class="entry-kcal">${missing
        ? `<button type="button" class="btn small" data-${prefix}lookup>Nährwerte suchen</button>`
        : `${fmt(c.kcal)} kcal`}</div>
      <div class="entry-actions">
        ${prefix && !missing ? `<button type="button" class="icon-btn" data-${prefix}lookup aria-label="Nährwerte suchen" title="Nährwerte aus der Produktsuche übernehmen">🔍</button>` : ''}
        ${prefix && draftFromAi && readLocal(AI_KEY_STORAGE)
          ? `<button type="button" class="icon-btn" data-${prefix}ai aria-label="Zutat mit KI ersetzen oder rausnehmen" title="Mit KI ersetzen oder rausnehmen">✨</button>` : ''}
        ${prefix ? `<button type="button" class="icon-btn" data-${prefix}edit aria-label="Zutat bearbeiten" title="Name und Nährwerte bearbeiten">✎</button>` : ''}
        <button type="button" class="icon-btn del" data-${prefix}del aria-label="${what} entfernen" title="Entfernen">✕</button>
      </div>
    </li>`;
}

function renderSport() {
  const acts = state.activities[currentDate] || [];
  const fueling = (state.diary[currentDate] || []).filter(e => e.meal === 'fueling');
  const burned = burnedKcal(currentDate);
  // Zuletzt verwendete kcal je Aktivitätsname, für Vorschläge beim Tippen
  const known = sportSuggestions();
  $('#sport').innerHTML = `
    <div class="meal-head">
      <h2>Sport &amp; Bewegung</h2>
      ${burned ? `<span class="meal-kcal">${fmt(burned)} kcal verbrannt</span>` : ''}
    </div>
    ${acts.length
      ? `<ul class="entries">${acts.map(a => `
        <li class="entry sport-entry" data-id="${esc(a.id)}">
          <div class="entry-main"><div class="entry-name">${esc(a.name)}</div></div>
          <label class="grams"><input type="number" min="1" step="1" value="${a.kcal}" data-sport-kcal aria-label="Verbrannte Kalorien"> kcal</label>
          <div class="entry-actions">
            <button type="button" class="icon-btn del" data-sport-del aria-label="Aktivität entfernen" title="Entfernen">✕</button>
          </div>
        </li>`).join('')}</ul>`
      : `<p class="hint">Hier eingetragene Kalorien erhöhen dein Kalorienziel für diesen Tag. Pro ${SPORT_KCAL_PER_G_CARBS} kcal kommt außerdem 1 g Kohlenhydrate zu deinem Ziel dazu.</p>`}
    <form class="sport-form" novalidate>
      <input type="text" name="name" list="sportNames" placeholder="Aktivität, z. B. Joggen 30 min" aria-label="Aktivität" autocomplete="off">
      <input type="number" name="kcal" min="1" step="1" placeholder="kcal" aria-label="Verbrannte Kalorien" inputmode="numeric">
      <button type="submit" class="btn small primary">Eintragen</button>
    </form>
    <datalist id="sportNames">${[...known.keys()].map(name => `<option value="${esc(name)}">`).join('')}</datalist>
    ${acts.length || fueling.length ? renderFueling(fueling) : ''}`;
}

/** Fueling = Essen/Trinken während dem Sport; normale Tagebucheinträge mit meal 'fueling'. */
function renderFueling(items) {
  const t = sumEntries(items);
  return `
    <div class="fueling">
      <div class="meal-head">
        <h3>Fueling</h3>
        ${items.length ? `<span class="meal-kcal">${fmt(t.kcal)} kcal · ${fmt(t.carbs)} g K</span>` : ''}
        <button type="button" class="btn small" data-add="fueling">+ Hinzufügen</button>
      </div>
      ${items.length
        ? `<ul class="entries">${items.map(e => itemRow(e)).join('')}</ul>`
        : '<p class="hint">Trag hier ein, was du während dem Sport isst und trinkst, z. B. Gels, Riegel oder Iso-Getränke. Es zählt zu deinen Tageswerten.</p>'}
    </div>`;
}

/** Map Aktivitätsname → zuletzt eingetragene kcal (neueste Tage zuerst). */
function sportSuggestions() {
  const known = new Map();
  for (const key of Object.keys(state.activities).sort().reverse()) {
    for (const a of [...state.activities[key]].reverse()) {
      if (!known.has(a.name)) known.set(a.name, a.kcal);
    }
  }
  return known;
}

function bindSportEvents() {
  const card = $('#sport');

  card.addEventListener('submit', ev => {
    ev.preventDefault();
    const form = ev.target;
    const name = form.elements.name.value.trim() || 'Sport';
    const kcal = toNum(form.elements.kcal.value);
    if (kcal === null || kcal <= 0 || kcal > 10000) {
      showToast('Bitte die verbrannten Kalorien als Zahl zwischen 1 und 10.000 eingeben.', true);
      form.elements.kcal.focus();
      return;
    }
    (state.activities[currentDate] ||= []).push({ id: uid(), name, kcal: Math.round(kcal) });
    saveState();
    renderDay();
    showToast(`${name}: ${fmt(kcal)} kcal eingetragen, dein Ziel steigt um ${fmt(kcal)} kcal und ${fmt(sportBonus(kcal).carbs)} g Kohlenhydrate`);
  });

  // Bekannte Aktivität gewählt → zuletzt verwendete kcal vorschlagen
  card.addEventListener('input', ev => {
    if (ev.target.name !== 'name') return;
    const kcalInput = ev.target.form.elements.kcal;
    const last = sportSuggestions().get(ev.target.value.trim());
    if (last && !kcalInput.value) kcalInput.value = last;
  });

  card.addEventListener('click', ev => {
    if (!ev.target.closest('[data-sport-del]')) return;
    const id = ev.target.closest('.entry').dataset.id;
    const list = (state.activities[currentDate] || []).filter(a => a.id !== id);
    if (list.length) state.activities[currentDate] = list;
    else delete state.activities[currentDate];
    saveState();
    renderDay();
  });

  card.addEventListener('change', ev => {
    if (!ev.target.matches('[data-sport-kcal]')) return;
    const act = (state.activities[currentDate] || []).find(a => a.id === ev.target.closest('.entry').dataset.id);
    const kcal = toNum(ev.target.value);
    if (act && kcal !== null && kcal > 0 && kcal <= 10000) {
      act.kcal = Math.round(kcal);
      saveState();
    } else {
      showToast('Die Kalorien müssen zwischen 1 und 10.000 liegen. Zum Entfernen ✕ benutzen.', true);
    }
    renderDay();
  });
}

function findEntry(el) {
  const li = el.closest('.entry');
  const entries = state.diary[currentDate] || [];
  return li ? { entries, index: entries.findIndex(e => e.id === li.dataset.id) } : null;
}

function bindDayEvents() {
  $('#prevDay').addEventListener('click', () => { currentDate = addDays(currentDate, -1); renderDay(); });
  $('#nextDay').addEventListener('click', () => { currentDate = addDays(currentDate, 1); renderDay(); });
  $('#todayBtn').addEventListener('click', () => { currentDate = today(); renderDay(); });

  // Mahlzeiten und das Fueling in der Sport-Karte teilen sich die Eintrags-Logik
  for (const container of [$('#meals'), $('#sport')]) {
    container.addEventListener('click', ev => {
      const addBtn = ev.target.closest('[data-add]');
      if (addBtn) return openAdd(addBtn.dataset.add);
      if (ev.target.closest('[data-del]')) {
        const found = findEntry(ev.target);
        if (!found || found.index < 0) return;
        found.entries.splice(found.index, 1);
        if (!found.entries.length) delete state.diary[currentDate];
        saveState();
        renderDay();
      }
    });

    container.addEventListener('change', ev => {
      if (!ev.target.matches('[data-grams]')) return;
      const found = findEntry(ev.target);
      if (!found || found.index < 0) return;
      const grams = toNum(ev.target.value);
      if (grams !== null && grams > 0) {
        found.entries[found.index].grams = grams;
        saveState();
      } else {
        showToast('Die Menge muss größer als 0 sein. Zum Entfernen ✕ benutzen.', true);
      }
      renderDay();
    });
  }
}

// =====================================================================
// Dialog: Lebensmittel hinzufügen
// =====================================================================

const dialog = $('#addDialog');
// 'diary' = ins Tagebuch, 'recipe' = neue Zutat für den Rezept-Entwurf,
// 'ingredient' = Nährwerte einer vorhandenen Entwurfs-Zutat ersetzen (lookupIngredientId)
let dialogTarget = 'diary';
let lookupIngredientId = null;
let dialogMeal = 'fruehstueck';
let selectedFood = null;
let searchResults = [];
let searchSeq = 0;

/**
 * Öffnet den Dialog. Mit `food` geht es direkt zur Mengeneingabe (z. B. „Rezept eintragen“),
 * mit `query` sind Filter, Online-Suche und manueller Name vorausgefüllt (Nährwerte für eine Zutat suchen).
 */
function openDialog({ target, title, meal = guessMeal(), food = null, query = '' }) {
  dialogTarget = target;
  dialogMeal = meal;
  selectedFood = null;
  $('#dlgTitle').textContent = title;
  $('#stepPick').hidden = false;
  $('#stepAmount').hidden = true;
  $('#recentFilter').value = query;
  $('#recipeFilter').value = '';
  $('#manualForm').reset();
  $('#manName').value = query;
  if (query) $('#searchInput').value = query;
  setMsg($('#manualMsg'), '');
  const forRecipe = target !== 'diary';
  $('#pickTabs [data-pick="recipes"]').hidden = forRecipe; // keine Rezepte in Rezepten
  $('#mealField').hidden = forRecipe;
  $('#confirmAdd').textContent = { diary: 'Hinzufügen', recipe: 'Zum Rezept hinzufügen', ingredient: 'Nährwerte übernehmen' }[target];
  renderRecent();
  renderRecipePick();
  dialog.showModal();
  if (food) {
    setPickTab('recipes');
    selectFood(food);
  } else if (query) {
    // Passendes gespeichertes Produkt zuerst anbieten, sonst gleich online suchen
    if ($('#recentList [data-food]')) {
      setPickTab('recent');
    } else {
      setPickTab('online');
      runSearch(query);
    }
  } else {
    setPickTab(Object.keys(state.foods).length ? 'recent' : 'online');
  }
}

function openIngredientLookup(ingredient) {
  lookupIngredientId = ingredient.id;
  openDialog({ target: 'ingredient', title: `Nährwerte für „${ingredient.name}“`, query: ingredient.name });
}

function openAdd(meal) {
  openDialog({ target: 'diary', meal, title: `Hinzufügen: ${mealLabel(meal)}` });
}

function guessMeal() {
  const h = new Date().getHours();
  return h < 11 ? 'fruehstueck' : h < 16 ? 'mittag' : h < 21 ? 'abend' : 'snack';
}

function setPickTab(name) {
  $$('#pickTabs [data-pick]').forEach(b => b.classList.toggle('active', b.dataset.pick === name));
  $$('#stepPick [data-pane]').forEach(p => { p.hidden = p.dataset.pane !== name; });
  const input = $({ recent: '#recentFilter', recipes: '#recipeFilter', online: '#searchInput', manual: '#manName' }[name]);
  input.focus();
  input.select(); // vorherige Suche lässt sich direkt überschreiben
}

function resultItem(food, attr) {
  return `
    <li>
      <button type="button" class="result" ${attr}>
        <span class="result-name">${esc(food.name)}</span>
        <span class="result-meta">${food.brand ? `${esc(food.brand)} · ` : ''}${fmt(food.per100.kcal)} kcal / 100 g</span>
      </button>
    </li>`;
}

function renderRecent() {
  const all = Object.values(state.foods);
  const q = $('#recentFilter').value.trim().toLowerCase();
  const foods = all
    .filter(f => !q || `${f.name} ${f.brand}`.toLowerCase().includes(q))
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .slice(0, 50);
  $('#recentList').innerHTML = foods.length
    ? foods.map(f => resultItem(f, `data-food="${esc(f.id)}"`)).join('')
    : `<li class="empty">${all.length ? 'Keine Treffer.' : 'Noch keine Produkte. Suche online oder trage eins manuell ein.'}</li>`;
}

function renderRecipePick() {
  const all = Object.values(state.recipes);
  const q = $('#recipeFilter').value.trim().toLowerCase();
  const recipes = all
    .filter(r => !q || r.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  $('#recipePickList').innerHTML = recipes.length
    ? recipes.map(r => {
      const s = recipeStats(r);
      return `
        <li>
          <button type="button" class="result" data-recipe="${esc(r.id)}">
            <span class="result-name">${esc(r.name)}</span>
            <span class="result-meta">${fmt(s.perServing.kcal)} kcal pro Portion · ${fmt(s.servings, 1)} ${s.servings === 1 ? 'Portion' : 'Portionen'}</span>
          </button>
        </li>`;
    }).join('')
    : `<li class="empty">${all.length ? 'Keine Treffer.' : 'Noch keine Rezepte. Lege eins im Reiter „Rezepte“ an.'}</li>`;
}

function setSearchStatus(text, isError = false) {
  const el = $('#searchStatus');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

async function runSearch(query) {
  const seq = ++searchSeq;
  const btn = $('#searchBtn');
  btn.disabled = true;
  searchResults = [];
  $('#searchResults').innerHTML = '';
  setSearchStatus('Suche läuft …');
  try {
    const results = await offSearch(query);
    if (seq !== searchSeq) return;
    searchResults = results;
    setSearchStatus(results.length
      ? `${results.length} Treffer`
      : 'Keine Produkte mit Nährwertangaben gefunden. Probiere einen anderen Begriff oder trage das Produkt manuell ein.');
    $('#searchResults').innerHTML = results.map((f, i) => resultItem(f, `data-idx="${i}"`)).join('');
  } catch (e) {
    if (seq === searchSeq) setSearchStatus(e.message, true);
  } finally {
    if (seq === searchSeq) btn.disabled = false;
  }
}

function selectFood(food) {
  selectedFood = food;
  $('#stepPick').hidden = true;
  $('#stepAmount').hidden = false;
  $('#selName').textContent = food.name;
  $('#selBrand').textContent = food.brand || '';
  $('#portionsField').hidden = !food.servingG;
  $('#servingHint').textContent = food.servingG ? `1 Portion = ${fmt(food.servingG, 1)} g` : '';
  const lookupTarget = dialogTarget === 'ingredient' && recipeDraft?.ingredients.find(i => i.id === lookupIngredientId);
  $('#gramsInput').value = lookupTarget ? lookupTarget.grams : food.servingG || 100; // Menge aus dem Rezept beibehalten
  syncPortions();
  $('#mealSelect').value = dialogMeal;
  setMsg($('#amountMsg'), '');
  renderPreview();
  $('#gramsInput').focus();
  $('#gramsInput').select();
}

function syncPortions() {
  const grams = toNum($('#gramsInput').value);
  if (selectedFood?.servingG) $('#portionsInput').value = grams === null ? '' : round(grams / selectedFood.servingG, 2);
}

function renderPreview() {
  if (!selectedFood) return;
  const grams = Math.max(0, toNum($('#gramsInput').value) || 0);
  const c = calcNutrients(selectedFood.per100, grams);
  const cell = (key, v) => (selectedFood.per100[key] === null ? '–' : fmtNut(key, v));
  $('#preview').innerHTML = `
    <table class="nut-table">
      <thead><tr><th>Nährwerte</th><th>pro 100 g</th><th>${fmt(grams, 1)} g</th></tr></thead>
      <tbody>
        ${NUTRIENTS.map(n => `
          <tr>
            <td>${esc(n.label)}</td>
            <td>${cell(n.key, selectedFood.per100[n.key])}</td>
            <td>${cell(n.key, c[n.key])}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    ${NUTRIENTS.some(n => selectedFood.per100[n.key] === null) ? '<p class="hint">„–“ bedeutet: Der Wert ist unbekannt und wird als 0 gezählt.</p>' : ''}`;
}

function confirmAdd() {
  const grams = toNum($('#gramsInput').value);
  if (grams === null || grams <= 0) {
    setMsg($('#amountMsg'), 'Bitte eine Menge größer als 0 eingeben.', true);
    $('#gramsInput').focus();
    return;
  }
  const f = selectedFood;
  const item = { id: uid(), name: f.name, brand: f.brand, code: f.code, grams, per100: { ...f.per100 } };
  if (!f.isRecipe) {
    state.foods[f.id] = {
      id: f.id, name: f.name, brand: f.brand, code: f.code, per100: { ...f.per100 }, servingG: f.servingG, lastUsed: Date.now(),
    };
  }

  if (dialogTarget === 'ingredient') {
    const ingredient = recipeDraft?.ingredients.find(i => i.id === lookupIngredientId);
    if (ingredient) {
      Object.assign(ingredient, { name: f.name, brand: f.brand, code: f.code, grams, per100: { ...f.per100 } });
      draftImport?.estimated.delete(ingredient.id); // Menge wurde gerade bestätigt
    }
    saveState(); // sichert nur das gemerkte Produkt
    dialog.close();
    renderDraft();
    return;
  }

  if (dialogTarget === 'recipe') {
    recipeDraft.ingredients.push(item);
    saveState(); // sichert nur das gemerkte Produkt; der Entwurf wird erst mit „Rezept speichern“ übernommen
    dialog.close();
    renderDraft();
    return;
  }

  const meal = $('#mealSelect').value;
  (state.diary[currentDate] ||= []).push({ ...item, meal });
  saveState();
  dialog.close();
  RENDERERS[currentView]();
  const day = currentDate === today() ? '' : ` (${formatDateLabel(currentDate)})`;
  showToast(`${f.name} zu ${mealLabel(meal)}${day} hinzugefügt`);
}

function bindDialogEvents() {
  $('#dlgClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', ev => { if (ev.target === dialog) dialog.close(); });

  $('#pickTabs').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-pick]');
    if (btn) setPickTab(btn.dataset.pick);
  });

  $('#recentFilter').addEventListener('input', renderRecent);
  $('#recentList').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-food]');
    const food = btn && state.foods[btn.dataset.food];
    if (food) selectFood(food);
  });

  $('#recipeFilter').addEventListener('input', renderRecipePick);
  $('#recipePickList').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-recipe]');
    const recipe = btn && state.recipes[btn.dataset.recipe];
    if (recipe) selectFood(recipeAsFood(recipe));
  });

  $('#searchForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const query = $('#searchInput').value.trim();
    if (query) runSearch(query);
  });
  $('#searchResults').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-idx]');
    const food = btn && searchResults[Number(btn.dataset.idx)];
    if (food) selectFood(food);
  });

  $('#manualForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const name = $('#manName').value.trim();
    const per100 = {};
    for (const n of NUTRIENTS) per100[n.key] = toNum($(`#man-${n.key}`).value);
    if (!name) return setMsg($('#manualMsg'), 'Bitte einen Namen eingeben.', true);
    if (per100.kcal === null || per100.kcal < 0) return setMsg($('#manualMsg'), 'Bitte die Kalorien pro 100 g angeben.', true);
    if (NUTRIENTS.some(n => per100[n.key] !== null && per100[n.key] < 0)) {
      return setMsg($('#manualMsg'), 'Nährwerte dürfen nicht negativ sein.', true);
    }
    setMsg($('#manualMsg'), '');
    selectFood({ id: `man-${uid()}`, name, brand: '', code: '', per100, servingG: null });
  });

  $('#backBtn').addEventListener('click', () => {
    $('#stepAmount').hidden = true;
    $('#stepPick').hidden = false;
  });
  $('#gramsInput').addEventListener('input', () => {
    syncPortions();
    renderPreview();
  });
  $('#portionsInput').addEventListener('input', () => {
    const portions = toNum($('#portionsInput').value);
    if (portions !== null && selectedFood?.servingG) $('#gramsInput').value = round(portions * selectedFood.servingG, 1);
    renderPreview();
  });
  for (const sel of ['#gramsInput', '#portionsInput']) {
    $(sel).addEventListener('keydown', ev => { if (ev.key === 'Enter') confirmAdd(); });
  }
  $('#confirmAdd').addEventListener('click', confirmAdd);
}

// =====================================================================
// Ansicht: Verlauf
// =====================================================================

function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

/** days: [{ key, totals, goal }] – goal ist das Tagesziel inkl. Sport. */
function chartSvg(days) {
  const W = 700, H = 260, padL = 48, padR = 8, padT = 22, padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const peak = Math.max(...days.map(d => Math.max(d.goal * 1.15, d.totals.kcal * 1.05)), 100);
  const step = niceStep(peak / 4);
  const yMax = Math.ceil(peak / step) * step;
  const y = v => padT + plotH - (v / yMax) * plotH;
  const slot = plotW / days.length;
  const barW = Math.max(4, slot * 0.62);
  const compact = days.length <= 7;

  let svg = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kalorien der letzten ${days.length} Tage">`;
  for (let v = 0; v <= yMax; v += step) {
    svg += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text class="axis" x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  }
  days.forEach((d, i) => {
    const v = d.totals.kcal;
    const x = padL + i * slot + (slot - barW) / 2;
    const top = y(v);
    const goalInfo = d.burned ? `Ziel ${fmt(d.goal)} kcal inkl. ${fmt(d.burned)} kcal Sport` : `Ziel ${fmt(d.goal)} kcal`;
    svg += `<g><title>${esc(axisLabel(d.key, true))}: ${fmt(v)} kcal · ${goalInfo}</title>`;
    if (v > 0) {
      svg += `<rect class="${v > d.goal ? 'bar-over' : 'bar-ok'}" x="${x}" y="${top}" width="${barW}" height="${padT + plotH - top}" rx="3"/>`;
      if (compact) svg += `<text class="val" x="${x + barW / 2}" y="${top - 6}" text-anchor="middle">${fmt(v)}</text>`;
    }
    svg += `<rect class="hit" x="${padL + i * slot}" y="${padT}" width="${slot}" height="${plotH}"/></g>`;
    // Bei 30 Tagen nur jede 5. Beschriftung, der heutige Tag immer
    if (compact || (days.length - 1 - i) % 5 === 0) {
      svg += `<text class="axis" x="${padL + i * slot + slot / 2}" y="${H - 8}" text-anchor="middle">${esc(axisLabel(d.key, compact))}</text>`;
    }
  });
  // Ziel-Linie als Stufen: an Sport-Tagen liegt sie höher
  const goalPath = days
    .map((d, i) => `${i ? 'L' : 'M'}${padL + i * slot},${y(d.goal)} L${padL + (i + 1) * slot},${y(d.goal)}`)
    .join(' ');
  svg += `<path class="goal" d="${goalPath}"/>`;
  return `${svg}</svg>`;
}

function renderHistory() {
  $$('#rangeSeg [data-range]').forEach(b => b.classList.toggle('active', Number(b.dataset.range) === historyRange));
  const end = today();
  const days = [];
  for (let i = historyRange - 1; i >= 0; i--) {
    const key = addDays(end, -i);
    const entries = state.diary[key] || [];
    const burned = burnedKcal(key);
    days.push({ key, totals: sumEntries(entries), logged: entries.length > 0, burned, goal: state.goals.kcal + burned });
  }
  $('#chart').innerHTML = chartSvg(days);
  const anySport = days.some(d => d.burned);
  $('#legendGoal').textContent = `Ziel (${fmt(state.goals.kcal)} kcal${anySport ? ' + Sport' : ''})`;

  const logged = days.filter(d => d.logged);
  if (!logged.length) {
    $('#averages').innerHTML = '<p class="muted">In diesem Zeitraum gibt es noch keine Einträge.</p>';
    return;
  }
  const avg = zeroTotals();
  for (const d of logged) for (const n of NUTRIENTS) avg[n.key] += d.totals[n.key] / logged.length;
  const avgBurned = logged.reduce((sum, d) => sum + d.burned, 0) / logged.length;
  const avgGoals = zeroTotals();
  for (const d of logged) {
    const goals = dayGoals(d.key);
    for (const n of NUTRIENTS) avgGoals[n.key] += goals[n.key] / logged.length;
  }
  $('#averages').innerHTML = `
    <p class="muted">Durchschnitt der ${logged.length} von ${days.length} Tagen, an denen du etwas eingetragen hast.${
      avgBurned ? ` An diesen Tagen hast du im Schnitt ${fmt(avgBurned)} kcal beim Sport verbrannt, das ist im Kalorien- und Kohlenhydratziel enthalten.` : ''}</p>
    <table class="nut-table">
      <thead><tr><th>Nährstoff</th><th>Ø pro Tag</th><th>Ziel</th><th>Erreicht</th></tr></thead>
      <tbody>
        ${NUTRIENTS.map(n => {
          const goal = avgGoals[n.key];
          const pct = goal > 0 ? (avg[n.key] / goal) * 100 : 0;
          const over = n.kind === 'max' && avg[n.key] > goal;
          return `
            <tr>
              <td>${esc(n.label)}</td>
              <td class="${over ? 'over' : ''}">${fmtNut(n.key, avg[n.key])}</td>
              <td>${fmtNut(n.key, goal)}</td>
              <td class="${over ? 'over' : ''}">${fmt(pct)} %</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

// =====================================================================
// Ansicht: Rezepte
// =====================================================================

let recipeDraft = null; // Arbeitskopie des Rezepts im Editor; null = Liste anzeigen
let recipeFilterTags = []; // gewählte Eigenschaften im Filter der Rezeptliste (nur für diese Sitzung)
let hideDisliked = false; // Rezepte mit „Mag ich nicht“-Zutaten ausblenden (nur für diese Sitzung)
let recipeSearch = ''; // Suchtext der Rezeptliste (Name oder Zutat)
let recipeSort = 'name';
const RECIPE_VIEW_STORAGE = 'kalorienTracker.recipeView'; // „cards“ oder „table“, pro Gerät gemerkt
let shopRecipeId = null; // Rezept, bei dem gerade „🛒 Einkaufen“ aufgeklappt ist
let shopPortions = null; // Portionen im aufgeklappten Formular (bleiben beim Neuzeichnen erhalten)
let shopChecks = new Map(); // Zutat-Index → vom Nutzer gesetztes Häkchen (überschreibt den Vorschlag)
let editingIngredientId = null;
// „✨ Ersetzen / Rausnehmen“ im KI-Entwurf: geöffnetes Feld { ingredientId, wish, status, isError, abort }
let swap = null;
let swapResult = null; // letzte KI-Änderung { text, hint, undo: Entwurf davor } für „Rückgängig“
// Nur bei Entwürfen aus eingefügtem Text: { estimated: Map(zutatId → Originalzeile), unrecognized: [], matched }
let draftImport = null;
let draftFromAi = false; // Entwurf stammt von der KI → Hinweis anzeigen, bei Abbruch zurück zur KI-Karte
let importOpen = false;
let aiOpen = false;

function renderRecipes() {
  $('#recipeList').hidden = !!recipeDraft;
  $('#recipeEditor').hidden = !recipeDraft;
  $('#importCard').hidden = !!recipeDraft || !importOpen;
  $('#aiCard').hidden = !!recipeDraft || !aiOpen;
  $('#dislikeCard').hidden = !!recipeDraft;
  if (recipeDraft) return renderRecipeEditor();
  if (aiOpen) renderAiCard();
  renderDislikes();
  const all = Object.values(state.recipes).sort((a, b) => a.name.localeCompare(b.name, 'de'));

  // Filter nach Eigenschaften (alle gewählten müssen passen); nur zeigen, wenn Rezepte Eigenschaften haben
  const usedTags = RECIPE_TAGS.filter(t => all.some(r => r.tags.includes(t.key)));
  recipeFilterTags = recipeFilterTags.filter(key => usedTags.some(t => t.key === key));
  const anyDisliked = all.some(r => recipeDislikes(r).length);
  if (!anyDisliked) hideDisliked = false;
  $('#recipeTagFilter').hidden = !usedTags.length && !anyDisliked;
  $('#recipeTagFilter').innerHTML = usedTags.map(t => `
    <button type="button" class="tag-chip" data-filter-tag="${t.key}" aria-pressed="${recipeFilterTags.includes(t.key)}">${t.icon} ${t.label}</button>`).join('')
    + (anyDisliked ? `
    <button type="button" class="tag-chip" data-filter-dislikes aria-pressed="${hideDisliked}">👎 ausblenden</button>` : '');

  const recipes = all
    .filter(r => recipeFilterTags.every(key => r.tags.includes(key)))
    .filter(r => !hideDisliked || !recipeDislikes(r).length)
    .filter(r => recipeMatchesSearch(r, recipeSearch));
  sortRecipes(recipes, recipeSort);

  $('#recipeTools').hidden = !all.length;
  const view = recipeView();
  $$('#recipeViewSeg [data-recipe-view]').forEach(b => b.classList.toggle('active', b.dataset.recipeView === view));

  const count = all.length
    ? `<p class="recipe-count">${recipes.length === all.length
      ? `${all.length} ${all.length === 1 ? 'Rezept' : 'Rezepte'}`
      : `${recipes.length} von ${all.length} Rezepten`}</p>`
    : '';
  $('#recipeItems').innerHTML = recipes.length
    ? count + (view === 'table' ? recipeTable(recipes) : `<ul class="recipe-items">${recipes.map(recipeRow).join('')}</ul>`)
    : all.length
      ? `${count}<p class="muted">${recipeSearch ? 'Keine Rezepte gefunden.' : 'Keine Rezepte mit diesen Eigenschaften.'}</p>`
      : '<p class="muted">Noch keine Rezepte. Lege ein Gericht aus mehreren Zutaten an und trage es danach mit wenigen Klicks als Portion ein.</p>';
}

function recipeView() {
  return readLocal(RECIPE_VIEW_STORAGE) === 'table' ? 'table' : 'cards';
}

/** Suche im Rezeptnamen und in den Zutaten; alle Wörter müssen vorkommen. */
function recipeMatchesSearch(recipe, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = `${recipe.name} ${recipe.ingredients.map(i => i.name).join(' ')}`.toLowerCase();
  return words.every(w => haystack.includes(w));
}

function sortRecipes(list, sort) {
  const perServing = new Map(list.map(r => [r.id, recipeStats(r).perServing]));
  const byName = (a, b) => a.name.localeCompare(b.name, 'de');
  const by = (key, dir) => (a, b) => ((perServing.get(a.id)[key] || 0) - (perServing.get(b.id)[key] || 0)) * dir || byName(a, b);
  const compare = {
    'kcal-asc': by('kcal', 1),
    'kcal-desc': by('kcal', -1),
    'protein-desc': by('protein', -1),
    'carbs-desc': by('carbs', -1),
  }[sort] || byName;
  return list.sort(compare);
}

/** Kompakte Tabelle: ein Tipp auf eine Zeile öffnet die Kochansicht. */
function recipeTable(recipes) {
  const rows = recipes.map(r => {
    const s = recipeStats(r);
    const p = s.perServing;
    const icons = r.tags.filter(key => !(key === 'vegetarian' && r.tags.includes('vegan'))).map(key => TAG[key].icon).join('');
    const disliked = recipeDislikes(r).length ? '👎' : '';
    return `
      <tr data-id="${esc(r.id)}" tabindex="0" role="button" aria-label="${esc(r.name)} kochen">
        <td>
          <span class="rt-name">${esc(r.name)}</span>
          <span class="rt-sub">${fmt(s.servings, 1)} ${s.servings === 1 ? 'Portion' : 'Portionen'}${icons || disliked ? ` · ${icons}${disliked}` : ''}</span>
        </td>
        <td>${fmt(p.kcal)}</td>
        <td>${fmt(p.protein)}</td>
        <td>${fmt(p.carbs)}</td>
        <td>${fmt(p.fat)}</td>
      </tr>`;
  }).join('');
  return `
    <div class="table-wrap">
      <table class="nut-table recipe-table">
        <thead><tr>
          <th>Rezept</th>
          <th>kcal</th>
          <th title="Eiweiß in Gramm">E</th>
          <th title="Kohlenhydrate in Gramm">K</th>
          <th title="Fett in Gramm">F</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="hint">Werte pro Portion · E = Eiweiß, K = Kohlenhydrate, F = Fett (in g) · Antippen öffnet die Kochansicht</p>`;
}

/** Ein Rezept als lesbarer Text zum Teilen (WhatsApp, Mail, Notizen). */
function recipeText(r) {
  const s = recipeStats(r);
  const p = s.perServing;
  const tags = r.tags
    .filter(key => !(key === 'vegetarian' && r.tags.includes('vegan')))
    .map(key => `${TAG[key].icon} ${TAG[key].label}`).join(', ');
  const steps = instructionSteps(r.instructions);
  const lines = [
    `🍽 ${r.name}`,
    `${fmt(s.servings, 1)} ${s.servings === 1 ? 'Portion' : 'Portionen'} · pro Portion ${fmt(p.kcal)} kcal, E ${fmt(p.protein)} g, K ${fmt(p.carbs)} g, F ${fmt(p.fat)} g`,
  ];
  if (tags) lines.push(tags);
  lines.push('', 'Zutaten:', ...r.ingredients.map(i => `- ${fmtShopGrams(i.grams)} ${i.name}`));
  if (steps.length) lines.push('', 'Zubereitung:', ...steps.map((step, index) => `${index + 1}. ${step}`));
  if (r.sourceUrl) lines.push('', `Video: ${r.sourceUrl}`);
  return lines.join('\n');
}

/** Handy: Teilen-Menü (WhatsApp, Mail, Notizen …); PC: in die Zwischenablage kopieren. */
async function shareRecipe(recipe) {
  const text = recipeText(recipe);
  if (navigator.share) {
    try {
      await navigator.share({ title: recipe.name, text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // Nutzer hat das Teilen-Menü geschlossen
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast(`„${recipe.name}“ in die Zwischenablage kopiert`);
  } catch {
    showToast('Teilen ist in diesem Browser nicht möglich.', true);
  }
}

/**
 * Hinweise zu den Eigenschaften eines Entwurfs: Grenzwerte laut Nährwerten und offensichtliche
 * tierische Zutaten (einfacher Wortabgleich, keine Garantie). Außerdem Vorschläge, welche Eigenschaft passt.
 */
const MEAT_FISH_PATTERN = /fleisch|hähnchen|hühnchen|huhn|hühner|puten|\bpute\b|rind|schwein|kalb|lamm|speck|schinken|salami|wurst|würstchen|bacon|chorizo|lachs|thunfisch|fisch|garnele|shrimp|krabbe|muschel|sardelle|anchovi|gelatine/i;
const ANIMAL_PATTERN = /\beier?\b|eigelb|eiklar|eiweiß(?!pulver)|milch|butter|sahne|käse|quark|joghurt|jogurt|skyr|schmand|crème fraîche|creme fraiche|mascarpone|ricotta|mozzarella|parmesan|feta|halloumi|molke|whey|honig/i;
const PLANT_BASED_PATTERN = /vegan|pflanz|soja|tofu|hafer|mandel|kokos|cashew|reis(?:milch|drink)|erdnussbutter|kakaobutter|seitan|tempeh/i;

function tagWarnings(recipe) {
  const warnings = [];
  const tags = recipe.tags || [];
  const s = recipeStats(recipe);
  const kcal = s.perServing.kcal || 0;
  const protein = s.perServing.protein || 0;
  const carbs = s.perServing.carbs || 0;
  const ingredientsKnown = recipe.ingredients.length && recipe.ingredients.every(i => i.per100.kcal !== null);
  if (ingredientsKnown && tags.includes('lowcal') && kcal > LOWCAL_MAX_KCAL) {
    warnings.push(`kalorienarm: eine Portion hat ${fmt(kcal)} kcal (höchstens ${LOWCAL_MAX_KCAL} kcal)`);
  }
  if (ingredientsKnown && tags.includes('highcarb') && carbs < HIGHCARB_MIN_G) {
    warnings.push(`kohlenhydratreich: eine Portion hat ${fmt(carbs, 1)} g Kohlenhydrate (mindestens ${HIGHCARB_MIN_G} g)`);
  }
  if (ingredientsKnown && tags.includes('highprotein') && protein < HIGHPROTEIN_MIN_G) {
    warnings.push(`proteinreich: eine Portion hat ${fmt(protein, 1)} g Eiweiß (mindestens ${HIGHPROTEIN_MIN_G} g)`);
  }
  const conflicts = key => recipe.ingredients
    .filter(i => !PLANT_BASED_PATTERN.test(i.name))
    .filter(i => MEAT_FISH_PATTERN.test(i.name) || (key === 'vegan' && ANIMAL_PATTERN.test(i.name)))
    .map(i => i.name);
  const dietTag = tags.includes('vegan') ? 'vegan' : tags.includes('vegetarian') ? 'vegetarian' : '';
  if (dietTag) {
    const names = conflicts(dietTag);
    if (names.length) warnings.push(`${TAG[dietTag].label}, aber diese Zutaten klingen nicht danach: ${names.join(', ')}`);
  }
  const suggestions = [];
  if (ingredientsKnown && !tags.includes('lowcal') && kcal > 0 && kcal <= LOWCAL_MAX_KCAL) suggestions.push('lowcal');
  if (ingredientsKnown && !tags.includes('highcarb') && carbs >= HIGHCARB_MIN_G) suggestions.push('highcarb');
  if (ingredientsKnown && !tags.includes('highprotein') && protein >= HIGHPROTEIN_MIN_G) suggestions.push('highprotein');
  return { warnings, suggestions };
}

function recipeRow(r) {
  const s = recipeStats(r);
  const p = s.perServing;
  const steps = instructionSteps(r.instructions);
  const disliked = [...new Set(recipeDislikes(r).flatMap(x => x.entries))];
  const badges = [
    ...r.tags
      .filter(key => !(key === 'vegetarian' && r.tags.includes('vegan'))) // „vegan“ reicht
      .map(key => `<span class="recipe-tag">${TAG[key].icon} ${TAG[key].label}</span>`),
    ...disliked.map(name => `<span class="recipe-tag dislike" title="Mag ich nicht">👎 ${esc(name)}</span>`),
  ];
  return `
    <li class="recipe-item" data-id="${esc(r.id)}">
      <div class="recipe-info">
        <div class="recipe-name">${esc(r.name)}</div>
        ${badges.length ? `<div class="recipe-tags">${badges.join('')}</div>` : ''}
        <div class="recipe-meta">${fmt(s.servings, 1)} ${s.servings === 1 ? 'Portion' : 'Portionen'} à ${fmt(s.servingG)} g · ${r.ingredients.length} ${r.ingredients.length === 1 ? 'Zutat' : 'Zutaten'}</div>
        <div class="recipe-meta">Pro Portion: <b>${fmt(p.kcal)} kcal</b> · E ${fmt(p.protein, 1)} g · K ${fmt(p.carbs, 1)} g · F ${fmt(p.fat, 1)} g</div>
        ${r.sourceUrl ? `<a class="video-link" href="${esc(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">▶ Video ansehen</a>` : ''}
        <details class="recipe-details">
          <summary>Zutaten${steps.length ? ' &amp; Zubereitung' : ''}</summary>
          <ul>${r.ingredients.map(i => `<li>${fmt(i.grams)} g ${esc(i.name)}</li>`).join('')}</ul>
          ${steps.length ? `<ol>${steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>` : ''}
        </details>
      </div>
      <div class="recipe-actions">
        <button type="button" class="btn small primary" data-recipe-cook>👩‍🍳 Kochen</button>
        <button type="button" class="btn small" data-recipe-log>Eintragen</button>
        <button type="button" class="btn small" data-recipe-shop>🛒 Einkaufen</button>
        <button type="button" class="btn small" data-recipe-edit>Bearbeiten</button>
        <button type="button" class="icon-btn" data-recipe-share aria-label="Rezept teilen" title="Rezept teilen">📤</button>
        <button type="button" class="icon-btn del" data-recipe-del aria-label="Rezept löschen" title="Löschen">✕</button>
      </div>
      ${r.id === shopRecipeId ? shopAddForm(r) : ''}
    </li>`;
}

/** Aufgeklapptes „🛒 Einkaufen“: Portionen und eine Zutatenliste, in der Vorrätiges schon abgewählt ist. */
function shopAddForm(r) {
  const portions = shopPortions ?? r.servings;
  const factor = portions > 0 ? portions / (r.servings > 0 ? r.servings : 1) : 0;
  const rows = r.ingredients.map((ing, index) => {
    const reason = shopSkipReason(ing.name);
    const checked = shopChecks.has(index) ? shopChecks.get(index) : !reason;
    const inPantry = reason === 'vorrätig';
    return `
      <li class="shop-pick${checked ? '' : ' off'}">
        <label class="check">
          <input type="checkbox" name="ing" value="${index}" ${checked ? 'checked' : ''}>
          <span><span class="shop-amount" data-grams="${ing.grams}">${fmtShopGrams(ing.grams * factor)}</span>${esc(ing.name)}${
            reason ? ` <span class="muted">(${reason})</span>` : ''}</span>
        </label>
        <button type="button" class="shop-chip${inPantry ? ' set' : ''}" data-pantry-toggle="${index}"
          title="${inPantry ? 'Nicht mehr als vorrätig merken' : 'Als „zu Hause vorrätig“ merken'}">📦 ${inPantry ? 'vorrätig' : 'hab ich'}</button>
      </li>`;
  }).join('');
  const count = r.ingredients.filter((ing, index) => (shopChecks.has(index) ? shopChecks.get(index) : !shopSkipReason(ing.name))).length;
  return `
    <form class="shop-add" novalidate>
      <label class="field">Portionen
        <input type="number" name="portions" min="0.5" step="0.5" value="${portions}" inputmode="decimal">
      </label>
      <ul class="shop-pick-list">${rows}</ul>
      <p class="hint">Mit Häkchen kommt die Zutat auf die Einkaufsliste. „📦 hab ich“ merkt sich eine Zutat als vorrätig für alle Rezepte (änderbar im Reiter „Einkauf“).</p>
      <div class="form-actions">
        <button type="submit" class="btn small primary" data-shop-submit ${count ? '' : 'disabled'}>${count ? `${count} ${count === 1 ? 'Zutat' : 'Zutaten'} auf die Einkaufsliste` : 'Alles vorrätig'}</button>
        <button type="button" class="btn small" data-shop-cancel>Abbrechen</button>
      </div>
    </form>`;
}

/** Zubereitungstext → einzelne Schritte (führende Nummern wie „1.“ werden entfernt). */
function instructionSteps(text) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim().replace(/^\d+[.)]\s*/, ''))
    .filter(Boolean);
}

/** Grobe Plausibilitätsprüfung von Nährwerten pro 100 g (fängt typische Schätzfehler ab). */
function nutrientsPlausible(p) {
  const protein = p.protein || 0;
  const carbs = p.carbs || 0;
  const fat = p.fat || 0;
  if (p.kcal > 900 || protein + carbs + fat > 100.5) return false;
  const expected = 4 * protein + 4 * carbs + 9 * fat + 2 * (p.fiber || 0);
  return Math.abs(p.kcal - expected) <= Math.max(30, p.kcal * 0.25);
}

function startRecipeEdit(recipe, { importInfo = null, fromAi = false } = {}) {
  if (!fromAi) aiAbort?.abort(); // anderes Rezept geöffnet: laufende KI-Anfrage würde es sonst überschreiben
  swap?.abort?.abort();
  swap = null;
  swapResult = null;
  recipeDraft = recipe
    ? structuredClone(recipe)
    : { id: `rec-${uid()}`, name: '', servings: 1, totalWeight: null, ingredients: [], instructions: '', sourceUrl: '', tags: [], updated: 0 };
  recipeDraft.tags = normalizeTags(recipeDraft.tags);
  draftImport = importInfo;
  draftFromAi = fromAi;
  editingIngredientId = null;
  renderRecipes();
  if (importInfo || fromAi) window.scrollTo(0, 0);
  else $('#recipeName').focus();
}

function closeRecipeEditor({ saved = false } = {}) {
  if (draftImport) {
    if (saved) $('#importCard').reset(); // Text wurde verarbeitet
    else importOpen = true; // verworfen → zurück zum eingefügten Text
  }
  if (draftFromAi) {
    if (saved) $('#aiPrompt').value = '';
    else aiOpen = true; // verworfen → zurück zur KI-Karte, Wunschtext bleibt stehen
  }
  swap?.abort?.abort();
  swap = null;
  swapResult = null;
  recipeDraft = null;
  draftImport = null;
  draftFromAi = false;
  editingIngredientId = null;
  renderRecipes();
}

function renderRecipeEditor() {
  $('#recipeEditorTitle').textContent = state.recipes[recipeDraft.id] ? 'Rezept bearbeiten' : 'Neues Rezept';
  $('#recipeName').value = recipeDraft.name;
  $('#recipeServings').value = recipeDraft.servings ?? '';
  $('#recipeWeight').value = recipeDraft.totalWeight ?? '';
  $('#recipeInstructions').value = recipeDraft.instructions ?? '';
  $('#recipeUrl').value = recipeDraft.sourceUrl ?? '';
  setMsg($('#recipeMsg'), '');
  renderDraft();
}

function renderDraft() {
  const items = recipeDraft.ingredients;
  $('#recipeIngredients').innerHTML = items.length
    ? items.map(i => itemRow(i, 'ing-')
      + (i.id === editingIngredientId ? ingredientEditor(i) : '')
      + (i.id === swap?.ingredientId ? aiSwapPanel(i) : '')).join('')
    : '<li class="empty">Noch keine Zutaten.</li>';

  const notes = [];
  if (swapResult) {
    notes.push(`✨ ${esc(swapResult.text)}${swapResult.hint ? ` <span class="muted">${esc(swapResult.hint)}</span>` : ''}
      <button type="button" class="btn small" data-swap-undo>↩ Rückgängig</button>`);
  }
  if (draftFromAi) {
    notes.push('<b>Von der KI erstellt.</b> Mengen und Nährwerte sind Schätzungen. Prüfe sie, bevor du speicherst: Mit 🔍 übernimmst du Werte aus der Produktsuche, mit ✎ korrigierst du sie selbst, mit ✨ ersetzt oder entfernst du eine Zutat samt Zubereitung.');
  }
  if (draftImport) {
    const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    notes.push(`<b>Aus dem Text erkannt:</b> ${count(items.length, 'Zutat', 'Zutaten')}${draftImport.matched
      ? `, davon ${draftImport.matched} mit Nährwerten aus deinen gespeicherten Produkten` : ''}. Bitte prüfe alles, bevor du speicherst.`);
    const estimated = items.filter(i => draftImport.estimated.has(i.id));
    if (estimated.length) {
      notes.push(`Mengen geschätzt, bitte prüfen: ${estimated
        .map(i => `${esc(i.name)} („${esc(draftImport.estimated.get(i.id))}“ → ${fmt(i.grams, 1)} g)`).join('; ')}`);
    }
    const skipped = draftImport.unrecognized;
    if (skipped.length) {
      notes.push(`Nicht als Zutat erkannt und ausgelassen: ${skipped.slice(0, 5).map(l => `„${esc(l)}“`).join(', ')}${
        skipped.length > 5 ? ` und ${skipped.length - 5} weitere Zeilen` : ''}`);
    }
  }
  const missing = items.filter(i => i.per100.kcal === null);
  if (missing.length) {
    notes.push(`🔍 Bei ${missing.length === 1 ? 'einer Zutat fehlen' : `${missing.length} Zutaten fehlen`} noch die Nährwerte. Tippe auf „Nährwerte suchen“ oder trage sie mit ✎ selbst ein (für Wasser oder Salz einfach 0 kcal).`);
  }
  const implausible = items.filter(i => i.per100.kcal !== null && !nutrientsPlausible(i.per100));
  for (const i of implausible) $(`#recipeIngredients .entry[data-id="${CSS.escape(i.id)}"]`)?.classList.add('warn');
  if (implausible.length) {
    notes.push(`⚠ Bitte prüfen (✎), die Kalorien passen nicht zu Eiweiß, Kohlenhydraten und Fett: ${implausible.map(i => esc(i.name)).join(', ')}`);
  }
  $('#recipeNote').innerHTML = notes.map(n => `<p>${n}</p>`).join('');
  $('#recipeNote').hidden = !notes.length;
  renderDraftNutrition();
}

function ingredientEditor(i) {
  return `
    <li class="ing-edit" data-id="${esc(i.id)}">
      <label class="field">Name <input type="text" data-ing-field="name" value="${esc(i.name)}" autocomplete="off"></label>
      <p class="hint">Nährwerte pro 100 g (leer = unbekannt)</p>
      <div class="form-grid">
        ${NUTRIENTS.map(n => `
          <label class="field">${esc(n.label)} (${n.unit})
            <input type="number" min="0" step="any" inputmode="decimal" data-ing-field="${n.key}" value="${i.per100[n.key] ?? ''}">
          </label>`).join('')}
      </div>
      <p class="msg error" data-ing-msg hidden></p>
      <div class="form-actions">
        <button type="button" class="btn small primary" data-ing-apply>Übernehmen</button>
        <button type="button" class="btn small" data-ing-cancel>Abbrechen</button>
      </div>
    </li>`;
}

function applyIngredientEdit(box) {
  const ingredient = recipeDraft.ingredients.find(i => i.id === box.dataset.id);
  if (!ingredient) return;
  const field = key => $(`[data-ing-field="${key}"]`, box).value;
  const name = field('name').trim();
  const per100 = {};
  for (const n of NUTRIENTS) per100[n.key] = toNum(field(n.key));
  const msg = $('[data-ing-msg]', box);
  if (!name) return setMsg(msg, 'Bitte einen Namen eingeben.', true);
  if (per100.kcal === null) return setMsg(msg, 'Die Kalorien pro 100 g sind Pflicht.', true);
  if (NUTRIENTS.some(n => per100[n.key] !== null && per100[n.key] < 0)) return setMsg(msg, 'Nährwerte dürfen nicht negativ sein.', true);
  ingredient.name = name;
  ingredient.per100 = per100;
  if (ingredient.brand === AI_BRAND) ingredient.brand = ''; // vom Nutzer geprüft
  editingIngredientId = null;
  renderDraft();
}

function renderDraftTags() {
  $('#recipeTags').innerHTML = tagChips(recipeDraft.tags, 'draft-tag');
  const { warnings, suggestions } = tagWarnings(recipeDraft);
  const notes = warnings.map(w => `<p>⚠ ${esc(w)}</p>`);
  const disliked = recipeDislikes(recipeDraft);
  if (disliked.length) {
    notes.unshift(`<p>👎 Enthält Zutaten, die du nicht magst: ${disliked
      .map(x => (x.entries.some(e => e.toLowerCase() === x.ingredient.toLowerCase())
        ? esc(x.ingredient)
        : `${esc(x.ingredient)} (${x.entries.map(esc).join(', ')})`)).join(', ')}</p>`);
  }
  if (suggestions.length) {
    notes.push(`<p>💡 Laut Nährwerten passt auch: ${suggestions
      .map(key => `<button type="button" class="tag-chip" data-draft-tag="${key}" aria-pressed="false">${TAG[key].icon} ${TAG[key].label}</button>`).join(' ')}</p>`);
  }
  $('#recipeTagNote').innerHTML = notes.join('');
  $('#recipeTagNote').hidden = !notes.length;
}

function renderDraftNutrition() {
  renderDraftTags(); // Grenzwerte hängen von Zutaten und Portionen ab
  const s = recipeStats(recipeDraft);
  $('#recipeWeight').placeholder = s.rawWeight ? `${fmt(s.rawWeight)} (Summe)` : 'Summe der Zutaten';
  if (!recipeDraft.ingredients.length) {
    $('#recipeNutrition').innerHTML = '';
    return;
  }
  const cell = (n, v) => (s.per100[n.key] === null ? '–' : fmtNut(n.key, v));
  $('#recipeNutrition').innerHTML = `
    <table class="nut-table">
      <thead><tr>
        <th>Nährwerte</th>
        <th>Gesamt (${fmt(s.weight)} g)</th>
        <th>pro Portion (${fmt(s.servingG)} g)</th>
        <th>pro 100 g</th>
      </tr></thead>
      <tbody>
        ${NUTRIENTS.map(n => `
          <tr>
            <td>${esc(n.label)}</td>
            <td>${cell(n, s.totals[n.key])}</td>
            <td>${cell(n, s.perServing[n.key])}</td>
            <td>${cell(n, s.per100[n.key])}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function isDraftDirty() {
  const saved = state.recipes[recipeDraft.id];
  if (!saved) return Boolean(recipeDraft.name.trim() || recipeDraft.ingredients.length);
  return JSON.stringify(saved) !== JSON.stringify(recipeDraft);
}

function bindRecipeEvents() {
  $('#newRecipeBtn').addEventListener('click', () => startRecipeEdit(null));

  $('#recipeSearch').addEventListener('input', ev => {
    recipeSearch = ev.target.value;
    renderRecipes();
  });
  $('#recipeSort').addEventListener('change', ev => {
    recipeSort = ev.target.value;
    renderRecipes();
  });
  $('#recipeViewSeg').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-recipe-view]');
    if (!btn) return;
    writeLocal(RECIPE_VIEW_STORAGE, btn.dataset.recipeView);
    renderRecipes();
  });

  // Übersicht: Zeile antippen (oder Enter) öffnet die Kochansicht
  const openFromRow = ev => {
    const row = ev.target.closest('.recipe-table tbody tr');
    const recipe = row && state.recipes[row.dataset.id];
    if (recipe) openCookView(recipe);
  };
  $('#recipeItems').addEventListener('click', openFromRow);
  $('#recipeItems').addEventListener('keydown', ev => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('.recipe-table tbody tr')) {
      ev.preventDefault();
      openFromRow(ev);
    }
  });

  $('#recipeTagFilter').addEventListener('click', ev => {
    if (ev.target.closest('[data-filter-dislikes]')) {
      hideDisliked = !hideDisliked;
      renderRecipes();
      return;
    }
    const chip = ev.target.closest('[data-filter-tag]');
    if (!chip) return;
    const key = chip.dataset.filterTag;
    recipeFilterTags = recipeFilterTags.includes(key) ? recipeFilterTags.filter(k => k !== key) : [...recipeFilterTags, key];
    renderRecipes();
  });

  // Eigenschaften im Editor (auch die Vorschläge im Hinweis) an- und abwählen
  for (const container of ['#recipeTags', '#recipeTagNote']) {
    $(container).addEventListener('click', ev => {
      const chip = ev.target.closest('[data-draft-tag]');
      if (!chip || !recipeDraft) return;
      recipeDraft.tags = toggleTag(recipeDraft.tags, chip.dataset.draftTag);
      renderDraftTags();
    });
  }

  $('#recipeItems').addEventListener('click', ev => {
    const li = ev.target.closest('.recipe-item');
    const recipe = li && state.recipes[li.dataset.id];
    if (!recipe) return;
    if (ev.target.closest('[data-recipe-cook]')) {
      openCookView(recipe);
    } else if (ev.target.closest('[data-recipe-share]')) {
      shareRecipe(recipe);
    } else if (ev.target.closest('[data-recipe-log]')) {
      openDialog({ target: 'diary', title: `Eintragen: ${formatDateLabel(currentDate)}`, food: recipeAsFood(recipe) });
    } else if (ev.target.closest('[data-recipe-shop]')) {
      shopRecipeId = shopRecipeId === recipe.id ? null : recipe.id;
      shopPortions = null;
      shopChecks = new Map();
      renderRecipes();
      $(`.recipe-item[data-id="${CSS.escape(recipe.id)}"] input[name="portions"]`)?.focus();
    } else if (ev.target.closest('[data-pantry-toggle]')) {
      const index = Number(ev.target.closest('[data-pantry-toggle]').dataset.pantryToggle);
      const ing = recipe.ingredients[index];
      if (!ing) return;
      if (pantryMatches(ing.name).length) removeFromPantry(ing.name);
      else addToPantry(ing.name);
      shopChecks.delete(index); // Vorschlag passt sich an den Vorrat an
      renderRecipes();
    } else if (ev.target.closest('[data-shop-cancel]')) {
      shopRecipeId = null;
      renderRecipes();
    } else if (ev.target.closest('[data-recipe-edit]')) {
      startRecipeEdit(recipe);
    } else if (ev.target.closest('[data-recipe-del]')) {
      if (!confirm(`Rezept „${recipe.name}“ löschen?\n\nBereits eingetragene Mahlzeiten bleiben erhalten.`)) return;
      delete state.recipes[recipe.id];
      saveState();
      renderRecipes();
    }
  });

  $('#recipeItems').addEventListener('submit', ev => {
    ev.preventDefault();
    const recipe = state.recipes[ev.target.closest('.recipe-item')?.dataset.id];
    if (!recipe) return;
    const portions = toNum(ev.target.elements.portions.value);
    if (!(portions > 0)) {
      showToast('Bitte eine Portionenzahl größer als 0 eingeben.', true);
      return;
    }
    const selected = new Set($$('input[name="ing"]', ev.target).filter(cb => cb.checked).map(cb => Number(cb.value)));
    if (!selected.size) return;
    addRecipeToShopping(recipe, portions, selected);
    shopRecipeId = null;
    renderRecipes();
  });

  // Häkchen und Portionen live übernehmen, ohne das Formular neu zu zeichnen (Fokus bleibt)
  $('#recipeItems').addEventListener('change', ev => {
    if (!ev.target.matches('.shop-add input[name="ing"]')) return;
    shopChecks.set(Number(ev.target.value), ev.target.checked);
    ev.target.closest('.shop-pick').classList.toggle('off', !ev.target.checked);
    updateShopSubmit(ev.target.form);
  });
  $('#recipeItems').addEventListener('input', ev => {
    if (!ev.target.matches('.shop-add input[name="portions"]')) return;
    const recipe = state.recipes[shopRecipeId];
    if (!recipe) return;
    shopPortions = toNum(ev.target.value);
    const factor = shopPortions > 0 ? shopPortions / (recipe.servings > 0 ? recipe.servings : 1) : 0;
    for (const amount of $$('.shop-amount[data-grams]', ev.target.form)) {
      amount.textContent = fmtShopGrams(Number(amount.dataset.grams) * factor);
    }
  });

  $('#recipeName').addEventListener('input', ev => { recipeDraft.name = ev.target.value; });
  $('#recipeServings').addEventListener('input', ev => {
    recipeDraft.servings = toNum(ev.target.value);
    renderDraftNutrition();
  });
  $('#recipeWeight').addEventListener('input', ev => {
    recipeDraft.totalWeight = toNum(ev.target.value);
    renderDraftNutrition();
  });
  $('#addIngredientBtn').addEventListener('click', () => openDialog({ target: 'recipe', title: 'Zutat hinzufügen' }));

  $('#recipeInstructions').addEventListener('input', ev => { recipeDraft.instructions = ev.target.value; });
  $('#recipeUrl').addEventListener('input', ev => { recipeDraft.sourceUrl = ev.target.value.trim(); });

  $('#recipeIngredients').addEventListener('click', ev => {
    const swapBox = ev.target.closest('.ai-swap');
    if (swapBox) {
      if (ev.target.closest('[data-swap-replace]')) runIngredientSwap('replace');
      else if (ev.target.closest('[data-swap-remove]')) runIngredientSwap('remove');
      else if (ev.target.closest('[data-swap-cancel]')) {
        swap?.abort?.abort();
        swap = null;
        renderDraft();
      }
      return;
    }
    const box = ev.target.closest('.ing-edit');
    if (box) {
      if (ev.target.closest('[data-ing-apply]')) applyIngredientEdit(box);
      if (ev.target.closest('[data-ing-cancel]')) {
        editingIngredientId = null;
        renderDraft();
      }
      return;
    }
    const row = ev.target.closest('.entry');
    if (!row) return;
    if (ev.target.closest('[data-ing-del]')) {
      recipeDraft.ingredients = recipeDraft.ingredients.filter(i => i.id !== row.dataset.id);
      if (swap?.ingredientId === row.dataset.id) {
        swap.abort?.abort(); // KI-Anpassung für diese Zutat ist hinfällig
        swap = null;
      }
      renderDraft();
    } else if (ev.target.closest('[data-ing-ai]')) {
      if (swap?.abort) return; // KI arbeitet gerade an einer anderen Zutat
      swap = swap?.ingredientId === row.dataset.id ? null : { ingredientId: row.dataset.id, wish: '', status: '', isError: false, abort: null };
      editingIngredientId = null;
      renderDraft();
      $('#recipeIngredients [data-swap-input]')?.focus();
    } else if (ev.target.closest('[data-ing-lookup]')) {
      const ingredient = recipeDraft.ingredients.find(i => i.id === row.dataset.id);
      if (ingredient) openIngredientLookup(ingredient);
    } else if (ev.target.closest('[data-ing-edit]')) {
      editingIngredientId = editingIngredientId === row.dataset.id ? null : row.dataset.id;
      renderDraft();
      $('#recipeIngredients [data-ing-field="kcal"]')?.focus();
    }
  });
  // Enter in Zutatenfeldern soll nicht das ganze Rezept speichern
  $('#recipeIngredients').addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' || !ev.target.matches('input')) return;
    ev.preventDefault();
    if (ev.target.matches('[data-swap-input]')) return runIngredientSwap('replace');
    const box = ev.target.closest('.ing-edit');
    if (box) applyIngredientEdit(box);
    else ev.target.blur(); // löst „change“ der Mengeneingabe aus
  });
  $('#recipeIngredients').addEventListener('input', ev => {
    if (ev.target.matches('[data-swap-input]') && swap) swap.wish = ev.target.value;
  });
  $('#recipeNote').addEventListener('click', ev => {
    if (!ev.target.closest('[data-swap-undo]') || !swapResult) return;
    recipeDraft = swapResult.undo;
    swapResult = null;
    swap = null;
    renderRecipeEditor(); // Name und Zubereitung stehen in eigenen Feldern
  });
  $('#recipeIngredients').addEventListener('change', ev => {
    if (!ev.target.matches('[data-ing-grams]')) return;
    const ingredient = recipeDraft.ingredients.find(i => i.id === ev.target.closest('.entry').dataset.id);
    const grams = toNum(ev.target.value);
    if (ingredient && grams !== null && grams > 0) {
      ingredient.grams = grams;
      draftImport?.estimated.delete(ingredient.id); // Menge wurde von Hand bestätigt
    } else {
      showToast('Die Menge muss größer als 0 sein. Zum Entfernen ✕ benutzen.', true);
    }
    renderDraft();
  });

  $('#recipeEditor').addEventListener('submit', ev => {
    ev.preventDefault();
    const d = recipeDraft;
    const msg = $('#recipeMsg');
    d.name = d.name.trim();
    if (!d.name) return setMsg(msg, 'Bitte einen Namen für das Rezept eingeben.', true);
    if (!(d.servings > 0)) return setMsg(msg, 'Die Anzahl der Portionen muss größer als 0 sein.', true);
    if (d.totalWeight !== null && !(d.totalWeight > 0)) {
      return setMsg(msg, 'Das fertige Gewicht muss größer als 0 sein oder leer bleiben.', true);
    }
    if (!d.ingredients.length) return setMsg(msg, 'Füge mindestens eine Zutat hinzu.', true);
    if (editingIngredientId) return setMsg(msg, 'Bitte die geöffnete Zutat erst übernehmen oder abbrechen.', true);
    if (swap?.abort) return setMsg(msg, 'Die KI passt das Rezept gerade an. Bitte kurz warten.', true);
    const missing = d.ingredients.filter(i => i.per100.kcal === null);
    if (missing.length) {
      return setMsg(msg, `Bei ${missing.map(i => `„${i.name}“`).join(', ')} fehlen noch die Nährwerte. Suche sie über „Nährwerte suchen“ oder trage sie mit ✎ ein.`, true);
    }
    d.sourceUrl = (d.sourceUrl ?? '').trim();
    if (d.sourceUrl && !isHttpUrl(d.sourceUrl)) return setMsg(msg, 'Der Link zum Video muss mit https:// beginnen.', true);
    d.instructions = d.instructions.trim();
    state.recipes[d.id] = { ...d, updated: Date.now() };
    if (!saveState()) return;
    closeRecipeEditor({ saved: true });
    showToast(`Rezept „${d.name}“ gespeichert`);
  });

  $('#cancelRecipeBtn').addEventListener('click', () => {
    if (isDraftDirty() && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
    closeRecipeEditor();
  });
}

// =====================================================================
// Rezept aus Text (kopierte Beschreibung eines TikTok-/Instagram-Videos)
// =====================================================================

// Gramm pro Einheit; est = nur ein Richtwert, der im Editor als „geschätzt“ markiert wird.
// grams null = Stückzahl, Gewicht kommt aus PIECE_WEIGHTS.
const UNITS = {};
for (const [names, grams, est] of [
  ['g gr gramm', 1], ['kg', 1000], ['mg', 0.001], ['ml', 1], ['l liter', 1000], ['cl', 10], ['dl', 100],
  ['oz', 28.35], ['lb lbs', 453.6],
  ['el esslöffel tbsp', 12, true], ['tl teelöffel tsp', 5, true],
  ['prise prisen', 0.5, true], ['msp messerspitze', 0.3, true],
  ['tasse tassen cup cups', 200, true], ['becher', 200, true], ['dose dosen', 400, true], ['glas gläser', 350, true],
  ['packung packungen pck pkg', 250, true], ['päckchen', 15, true],
  ['scheibe scheiben', 25, true], ['bund', 50, true], ['handvoll', 30, true], ['zehe zehen', 4, true],
  ['schuss', 10, true], ['spritzer', 5, true], ['würfel', 10, true], ['scoop scoops messlöffel', 30, true],
  ['stück stk stck', null, true],
]) {
  for (const name of names.split(' ')) UNITS[name] = { grams, est: Boolean(est) };
}

// Typisches Gewicht pro Stück (erste passende Zeile gewinnt, daher Spezielles vor Allgemeinem)
const PIECE_WEIGHTS = [
  [/frühlingszwiebel|lauchzwiebel/, 15], [/zwiebel/, 80], [/schalotte/, 25], [/knoblauch/, 4],
  [/cherrytomate|kirschtomate|cocktailtomate|datteltomate/, 15], [/tomate/, 100],
  [/süßkartoffel/, 250], [/kartoffel/, 150], [/karotte|möhre/, 80],
  [/paprika(?!pulver|mark)/, 150], [/zucchini/, 250], [/aubergine/, 300], [/gurke/, 400], [/avocado/, 150],
  [/champignon|pilz/, 20], [/chili(?!flocken|pulver|sauce|soße)/, 5],
  [/banane/, 120], [/apfel|äpfel/, 150], [/birne/, 150], [/orange/, 150], [/zitrone/, 100], [/limette/, 60], [/dattel/, 8],
  [/eigelb/, 18], [/eiweiß(?!pulver)|eiklar/, 35], [/\beier?\b/, 60],
  [/brötchen/, 60], [/toast/, 25], [/tortilla|wrap/, 60], [/pita/, 80],
  [/hähnchenbrust|hühnerbrust|putenbrust|hähnchenfilet/, 150], [/lachsfilet/, 125],
  [/mozzarella/, 125], [/feta/, 200],
];
const DEFAULT_PIECE_G = 100;

const SPICES = /salz|pfeffer|gewürz|paprikapulver|currypulver|curry|kurkuma|zimt|muskat|oregano|basilikum|thymian|rosmarin|petersilie|schnittlauch|kräuter|chiliflocken|knoblauchpulver|zwiebelpulver|backpulver|natron|vanille|kümmel|majoran|dill|koriander|cayenne|sesam/i;

const FRACTION_CHARS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
const NUMBER_WORDS = {
  ein: 1, eine: 1, einen: 1, einem: 1, einer: 1, eins: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6,
  halbe: 0.5, halben: 0.5, halber: 0.5, halbes: 0.5, a: 1, an: 1, one: 1, two: 2, three: 3, half: 0.5,
};
const NUM = String.raw`\d+(?:[.,]\d+)?(?:\s+\d+\/\d+|\s*[½¼¾⅓⅔⅛])?|\d+\/\d+|[½¼¾⅓⅔⅛]`;
// Menge am Zeilenanfang, auch als Spanne („2-3“); danach muss Leerraum, ein Buchstabe oder das Ende kommen („3-Zutaten-Brot“ ist keine Menge)
const AMOUNT_START = new RegExp(String.raw`^(?:ca\.?|circa|etwa|about)?\s*(${NUM})(?:\s*(?:-|–|bis)\s*(${NUM}))?(?=[\sa-zäöüß]|$)`, 'i');
const INGREDIENT_HEADER = /^(?:die\s+)?(?:zutaten|ingredients?|du brauchst|was du brauchst|das brauchst du|einkaufsliste)\b/i;
const STEPS_HEADER = /^(?:zubereitung|anleitung|so geht'?s|so wird'?s gemacht|schritte|arbeitsschritte|instructions?|directions|method|steps|how to)\b/i;

function parseNumber(s) {
  let text = s.trim();
  let total = 0;
  const fraction = text.match(/[½¼¾⅓⅔⅛]/);
  if (fraction) {
    total += FRACTION_CHARS[fraction[0]];
    text = text.replace(fraction[0], '').trim();
  }
  const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return total + Number(mixed[1]) + mixed[2] / mixed[3];
  const simple = text.match(/^(\d+)\/(\d+)$/);
  if (simple) return total + simple[1] / simple[2];
  return total + (toNum(text) ?? 0);
}

function pieceWeight(name) {
  const lower = name.toLowerCase();
  return PIECE_WEIGHTS.find(([pattern]) => pattern.test(lower))?.[1] ?? DEFAULT_PIECE_G;
}

/** Entfernt Emojis, Hashtags, Erwähnungen und Aufzählungszeichen. */
function cleanLine(raw) {
  return raw
    .replace(/(\d)️?⃣/gu, '$1.') // Tasten-Emoji „1️⃣“ → „1.“
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/(^|\s)@[\w.]+/g, ' ')
    .replace(/^[\s\-–—•*·▪●○◦►▶→>✓✔☐☑▢□]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripStepNumber(line) {
  return line.replace(/^(?:\d+[.)]|schritt\s*\d+:?|step\s*\d+:?)\s*/i, '').trim();
}

/** „200 g Mehl“, „2 EL Öl“, „1 Dose Tomaten (400 g)“, „Mehl: 200 g“, „Salz“ → { name, grams, estimated, hadAmount } */
function parseIngredientLine(line) {
  let text = line;
  let explicitGrams = null;
  text = text.replace(/\(\s*(?:ca\.?\s*|je\s*)?(\d+(?:[.,]\d+)?)\s*(?:g|gr|gramm|ml)\s*\)/i, (_, n) => {
    explicitGrams = toNum(n);
    return ' ';
  });

  let amount = null;
  let unit = null;
  const start = text.match(AMOUNT_START);
  if (start) {
    amount = parseNumber(start[1]);
    if (start[2]) amount = (amount + parseNumber(start[2])) / 2;
    text = text.slice(start[0].length).replace(/^\s*x(?=\s)/i, '');
  } else {
    const word = text.match(/^\s*([a-zäöüß]+)\s+/i);
    if (word && NUMBER_WORDS[word[1].toLowerCase()] !== undefined) {
      amount = NUMBER_WORDS[word[1].toLowerCase()];
      text = text.slice(word[0].length);
    }
  }
  const unitMatch = text.match(/^\s*([a-zäöüß]+)\.?(?=[\s,(]|$)/i);
  if (unitMatch && UNITS[unitMatch[1].toLowerCase()]) {
    unit = UNITS[unitMatch[1].toLowerCase()];
    text = text.slice(unitMatch[0].length);
    if (amount === null) amount = 1; // „Prise Salz“
  }
  if (amount === null) {
    const end = text.match(/^(.*?)[\s:,–-]*\b(\d+(?:[.,]\d+)?)\s*(g|gr|kg|ml|l|el|tl)\.?\s*$/i);
    if (end && end[1].trim()) {
      text = end[1];
      amount = toNum(end[2]);
      unit = UNITS[end[3].toLowerCase()];
    }
  }

  const name = text
    .replace(/\(.*?\)/g, ' ')
    .split(/,|\s[-–]\s/)[0]
    .replace(/^\s*(?:von|vom|der|die|das|of)\s+/i, '')
    .replace(/^(?:etwas|n\.\s*b\.|nach belieben)\s+/i, '')
    .replace(/\s+(?:nach belieben|n\.\s*b\.|zum (?:braten|anbraten|garnieren|servieren|bestreuen))\.?$/i, '')
    .replace(/[:;.!]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name || !/[a-zäöüß]/i.test(name)) return null;

  let grams;
  let estimated = false;
  if (unit && !unit.est) {
    grams = amount * unit.grams;
  } else if (explicitGrams) {
    grams = explicitGrams * (amount || 1);
  } else if (unit) {
    grams = amount * (unit.grams ?? pieceWeight(name));
    estimated = true;
  } else if (amount !== null) {
    grams = amount * pieceWeight(name);
    estimated = true;
  } else {
    grams = SPICES.test(name) ? 2 : 20; // Menge fehlt im Text
    estimated = true;
  }
  if (!(grams > 0)) return null;
  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    grams: round(grams, 1),
    estimated,
    hadAmount: amount !== null || explicitGrams !== null,
    source: line,
  };
}

/** Zerlegt eingefügten Text in Titel, Portionen, Link, Zutaten und Schritte. */
function parseRecipeText(text) {
  const result = { name: '', servings: null, sourceUrl: '', ingredients: [], steps: [], unrecognized: [] };
  let section = 'auto'; // bis eine Überschrift wie „Zutaten“ oder „Zubereitung“ kommt

  for (const raw of String(text).split(/\r?\n/)) {
    let line = raw;
    const url = line.match(/https?:\/\/\S+/i);
    if (url) {
      if (!result.sourceUrl) result.sourceUrl = url[0];
      line = line.replace(/https?:\/\/\S+/gi, ' ');
    }
    line = cleanLine(line);
    if (!line || !/[\p{L}\d½¼¾]/u.test(line)) continue;
    const words = line.split(' ').length;

    if (!result.servings && section !== 'steps' && words <= 8) {
      const servings = line.match(/(\d+)\s*(?:portionen|portion|personen|person|servings?)\b/i)
        || line.match(/\b(?:für|for)\s+(\d+)\b(?!\s*(?:min|minuten|sek|std|stunden|grad|°))/i);
      if (servings) result.servings = Number(servings[1]);
    }
    if (INGREDIENT_HEADER.test(line) && words <= 8) { section = 'ingredients'; continue; }
    if (STEPS_HEADER.test(line) && words <= 6) { section = 'steps'; continue; }
    if (/:$/.test(line) && words <= 5) continue; // Zwischenüberschrift wie „Für die Soße:“

    if (section === 'steps') {
      const step = stripStepNumber(line);
      if (step) result.steps.push(step);
      continue;
    }
    if (section === 'auto' && /^(?:\d+[.)]|schritt\s*\d+:?|step\s*\d+:?)\s+\D/i.test(line)) {
      result.steps.push(stripStepNumber(line));
      continue;
    }

    const parsed = parseIngredientLine(line);
    const shortName = parsed && parsed.name.split(' ').length <= 6; // lange Sätze mit Zahlen sind eher Schritte
    if (parsed && shortName && parsed.hadAmount) {
      result.ingredients.push(parsed);
      continue;
    }
    // Zeilen ohne Menge wie „Salz, Pfeffer“ → einzelne Zutaten mit geschätzter Menge
    const parts = words <= 8
      ? line.split(/,|\s+und\s+|\s*&\s*|\s+\+\s+/i).map(part => parseIngredientLine(part)).filter(p => p && p.name.split(' ').length <= 4)
      : [];
    if (section === 'ingredients') {
      if (parts.length) result.ingredients.push(...parts);
      else result.unrecognized.push(line);
      continue;
    }
    // Ohne Überschriften: erste kurze Zeile ist der Titel, längere Sätze nach den Zutaten sind Schritte
    if (!result.name && !result.ingredients.length && words <= 10) {
      result.name = line.replace(/[:!.]+$/, '');
    } else if (result.ingredients.length && words >= 5) {
      result.steps.push(stripStepNumber(line));
    } else if (parts.length && parts.every(p => SPICES.test(p.name))) {
      result.ingredients.push(...parts);
    } else {
      result.unrecognized.push(line);
    }
  }
  return result;
}

/** Gespeichertes Produkt, dessen Name alle Wörter der Zutat enthält (zuletzt verwendetes zuerst). */
function matchSavedFood(name) {
  const wordsOf = s => s.toLowerCase().split(/[^a-zäöüß0-9]+/).filter(w => w.length > 1);
  const wanted = wordsOf(name);
  if (!wanted.length) return null;
  return Object.values(state.foods)
    .filter(f => {
      const have = wordsOf(f.name);
      return wanted.every(w => have.includes(w));
    })
    .sort((a, b) => b.lastUsed - a.lastUsed)[0] || null;
}

function bindImportEvents() {
  $('#importOpenBtn').addEventListener('click', () => {
    importOpen = true;
    renderRecipes();
    $('#importText').focus();
  });
  $('#importClose').addEventListener('click', () => {
    importOpen = false;
    renderRecipes();
  });

  $('#importCard').addEventListener('submit', ev => {
    ev.preventDefault();
    const msg = $('#importMsg');
    const text = $('#importText').value;
    if (!text.trim()) return setMsg(msg, 'Bitte zuerst den Text aus dem Video einfügen.', true);
    const parsed = parseRecipeText(text);
    if (!parsed.ingredients.length) {
      return setMsg(msg, 'Im Text wurden keine Zutaten gefunden. Am besten klappt es mit einer Liste wie „200 g Mehl“, eine Zutat pro Zeile.', true);
    }
    setMsg(msg, '');

    const estimated = new Map();
    let matched = 0;
    const emptyPer100 = Object.fromEntries(NUTRIENTS.map(n => [n.key, null]));
    const ingredients = parsed.ingredients.map(p => {
      const food = matchSavedFood(p.name);
      const ingredient = {
        id: uid(),
        name: food ? food.name : p.name,
        brand: food ? food.brand : '',
        code: food ? food.code : '',
        grams: p.grams,
        per100: food ? { ...food.per100 } : { ...emptyPer100 },
      };
      if (food) matched++;
      if (p.estimated) estimated.set(ingredient.id, p.source);
      return ingredient;
    });

    const servingsInput = toNum($('#importServings').value);
    const url = $('#importUrl').value.trim();
    importOpen = false;
    startRecipeEdit({
      id: `rec-${uid()}`,
      name: parsed.name || 'Rezept aus Video',
      servings: servingsInput > 0 ? servingsInput : parsed.servings || 1,
      totalWeight: null,
      ingredients,
      instructions: parsed.steps.join('\n'),
      sourceUrl: isHttpUrl(url) ? url : parsed.sourceUrl,
      updated: 0,
    }, { importInfo: { estimated, unrecognized: parsed.unrecognized, matched } });
  });
}

// =====================================================================
// KI-Rezepte (Google Gemini, direkt aus dem Browser)
// =====================================================================

// Schlüssel und Modell bewusst außerhalb von `state`: kommen nicht ins Backup und nicht in geteilte Dateien
const AI_KEY_STORAGE = 'kalorienTracker.geminiKey';
const AI_MODEL_STORAGE = 'kalorienTracker.geminiModel';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const AI_FALLBACK_MODEL = 'gemini-2.5-flash';
const AI_TIMEOUT_MS = 120000;
const AI_BRAND = 'KI-Schätzung';

// Deutsche Feldnamen im Antwortschema; Nährstoffe ohne Eintrag hier fragt die KI nicht ab
const AI_FIELDS = {
  kcal: 'kcal_100g',
  protein: 'eiweiss_100g',
  carbs: 'kohlenhydrate_100g',
  fat: 'fett_100g',
  fiber: 'ballaststoffe_100g',
};

const AI_SCHEMA = (() => {
  const nutrientFields = NUTRIENTS.map(n => AI_FIELDS[n.key]).filter(Boolean);
  const ingredientProps = ['name', 'menge_g', ...nutrientFields];
  return {
    type: 'OBJECT',
    properties: {
      name: { type: 'STRING' },
      zutaten: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: Object.fromEntries(ingredientProps.map(f => [f, { type: f === 'name' ? 'STRING' : 'NUMBER' }])),
          required: ingredientProps,
          propertyOrdering: ingredientProps,
        },
      },
      zubereitung: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['name', 'zutaten', 'zubereitung'],
    propertyOrdering: ['name', 'zutaten', 'zubereitung'],
  };
})();

const AI_SYSTEM_PROMPT = `Du bist Koch und Ernährungsberater und erstellst alltagstaugliche Rezepte auf Deutsch mit Zutaten aus deutschen Supermärkten.

Antworte im vorgegebenen JSON-Schema:
- "name": kurzer Rezeptname.
- "zutaten": alle Zutaten für ALLE Portionen zusammen, auch Öl, Butter und Gewürze.
  - "menge_g": Gramm im abgewogenen Zustand (Nudeln, Reis, Hülsenfrüchte roh bzw. trocken; Fleisch und Fisch roh; Flüssigkeiten 1 ml = 1 g).
  - Nährwerte pro 100 g der Zutat in genau diesem Zustand, realistische Durchschnittswerte. Kohlenhydrate ohne Ballaststoffe.
  - Die Kalorien müssen zu den Makros passen: kcal ≈ 4 × Eiweiß + 4 × Kohlenhydrate + 9 × Fett + 2 × Ballaststoffe.
- "zubereitung": kurze Arbeitsschritte ohne Nummerierung.`;

let aiAbort = null;
let aiModels = null; // in dieser Sitzung geladene Modell-IDs; null = noch nicht geladen

class AiError extends Error {
  constructor(message, { aborted = false, badKey = false, badModel = false } = {}) {
    super(message);
    Object.assign(this, { aborted, badKey, badModel });
  }
}

function readLocal(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

function writeLocal(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function geminiError(status, data) {
  const message = String(data?.error?.message || '');
  const reasons = (data?.error?.details || []).map(d => d?.reason).filter(Boolean);
  if (reasons.includes('API_KEY_INVALID') || /api key not valid|api_key_invalid/i.test(message)) {
    return new AiError('Der API-Schlüssel ist ungültig. Prüfe, ob du ihn vollständig kopiert hast.', { badKey: true });
  }
  if (status === 429) {
    return new AiError('Das kostenlose Kontingent von Gemini ist gerade ausgeschöpft. Bitte in ein paar Minuten nochmal versuchen, spätestens morgen geht es wieder.');
  }
  if (status === 403) {
    return new AiError('Google lehnt diesen API-Schlüssel ab. Erstelle in Google AI Studio einen neuen Schlüssel und trage ihn hier ein.', { badKey: true });
  }
  if (status === 404) {
    return new AiError('Das gewählte KI-Modell ist nicht mehr verfügbar. Bitte nochmal versuchen, die App wählt automatisch ein anderes.', { badModel: true });
  }
  if (/location is not supported/i.test(message)) {
    return new AiError('Google Gemini ist in deinem Land nicht verfügbar.');
  }
  if (status >= 500) return new AiError('Gemini ist gerade überlastet. Bitte gleich nochmal versuchen.');
  return new AiError(`Gemini meldet einen Fehler (${status})${message ? `: ${message}` : ''}.`);
}

/** Anfrage an die Gemini-API mit Zeitlimit; `signal` kann zusätzlich von „Abbrechen“ kommen. */
async function geminiFetch(path, { key, body = null, signal = null, timeoutMs = AI_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
  const onCancel = () => ctrl.abort('cancel');
  signal?.addEventListener('abort', onCancel);
  try {
    const res = await fetch(`${GEMINI_BASE}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'x-goog-api-key': key, 'Content-Type': 'application/json' } : { 'x-goog-api-key': key },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { if (ctrl.signal.aborted) throw e; }
    if (!res.ok) throw geminiError(res.status, data);
    return data;
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (ctrl.signal.aborted) {
      throw ctrl.signal.reason === 'cancel'
        ? new AiError('Abgebrochen.', { aborted: true })
        : new AiError('Die KI hat zu lange gebraucht. Bitte nochmal versuchen.');
    }
    throw new AiError(navigator.onLine
      ? 'Google Gemini ist nicht erreichbar. Bitte später nochmal versuchen.'
      : 'Keine Internetverbindung. Für die KI brauchst du Internet.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCancel);
  }
}

/** Stabile Flash-Modelle (keine Preview-, Audio- oder Bildmodelle), bestes zuerst. */
async function geminiListModels(key) {
  const data = await geminiFetch('models?pageSize=1000', { key, timeoutMs: 15000 });
  const ids = (data?.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => String(m.name || '').replace(/^models\//, ''))
    .filter(id => /^gemini-\d+(?:\.\d+)?-flash(?:-lite)?$/.test(id));
  const rank = id => (id.endsWith('-lite') ? 0 : 1000) + parseFloat(id.match(/^gemini-([\d.]+)/)[1]);
  return [...new Set(ids)].sort((a, b) => rank(b) - rank(a));
}

async function currentAiModel(key) {
  const stored = readLocal(AI_MODEL_STORAGE);
  if (stored) return stored;
  try {
    aiModels = await geminiListModels(key);
  } catch (e) {
    if (e.badKey || e.aborted) throw e;
    return AI_FALLBACK_MODEL; // Liste nicht ladbar: bewährtes Modell versuchen
  }
  const model = aiModels[0] || AI_FALLBACK_MODEL;
  writeLocal(AI_MODEL_STORAGE, model);
  return model;
}

function todaysRest() {
  const key = today();
  const totals = sumEntries(state.diary[key] || []);
  const goals = dayGoals(key);
  return Object.fromEntries(NUTRIENTS.map(n => [n.key, Math.max(0, goals[n.key] - totals[n.key])]));
}

const AI_TAGS_STORAGE = 'kalorienTracker.aiTags'; // zuletzt gewählte Eigenschaften, z. B. wer immer vegan kocht
let aiTags = null; // wird beim ersten Öffnen aus dem Speicher geladen

function currentAiTags() {
  if (!aiTags) {
    try { aiTags = normalizeTags(JSON.parse(readLocal(AI_TAGS_STORAGE) || '[]')); } catch { aiTags = []; }
  }
  return aiTags;
}

function buildAiUserPrompt(wish, servings, useBudget, tags = []) {
  const lines = [
    `Wunsch: ${wish || 'Überrasche mich mit einem ausgewogenen, einfachen Gericht.'}`,
    `Portionen: ${servings}`,
  ];
  const rules = tags
    .filter(key => !(key === 'vegetarian' && tags.includes('vegan'))) // vegan ist strenger
    .map(key => `- ${TAG[key].prompt}`);
  if (rules.length) lines.push(`Das Rezept MUSS diese Anforderungen erfüllen:\n${rules.join('\n')}`);
  if (state.dislikes.length) {
    lines.push(`Diese Zutaten mag ich nicht. Verwende sie auf keinen Fall, auch nicht in anderer Form oder als Unterart: ${state.dislikes.map(d => d.name).join(', ')}`);
  }
  if (useBudget) {
    const rest = todaysRest();
    lines.push(rest.kcal < 150
      ? 'Mein Kalorienbudget für heute ist fast aufgebraucht. Eine Portion soll sehr leicht sein (unter 150 kcal).'
      : `Mein Restbudget für heute: ${fmt(rest.kcal)} kcal, ${fmt(rest.carbs)} g Kohlenhydrate, ${fmt(rest.fat)} g Fett. `
        + `Mir fehlen noch ${fmt(rest.protein)} g Eiweiß und ${fmt(rest.fiber)} g Ballaststoffe. `
        + 'EINE Portion soll in dieses Budget passen und möglichst viel vom fehlenden Eiweiß liefern.');
  }
  return lines.join('\n');
}

/** Textteile der ersten Antwort (ohne Denk-Zusammenfassungen). */
function geminiText(data) {
  const candidate = data?.candidates?.[0];
  if (!candidate) {
    throw new AiError(data?.promptFeedback?.blockReason
      ? 'Google hat die Anfrage abgelehnt. Formuliere deinen Wunsch bitte anders.'
      : 'Die KI hat keine Antwort geliefert. Bitte nochmal versuchen.');
  }
  const text = (candidate.content?.parts || [])
    .filter(p => !p.thought && typeof p.text === 'string')
    .map(p => p.text)
    .join('');
  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new AiError('Die Antwort der KI wurde abgeschnitten. Bitte nochmal versuchen, eventuell mit einem einfacheren Gericht.');
  }
  if (!text.trim()) {
    throw new AiError(candidate.finishReason && candidate.finishReason !== 'STOP'
      ? 'Google hat die Antwort zurückgehalten. Formuliere deinen Wunsch bitte anders.'
      : 'Die KI hat keine Antwort geliefert. Bitte nochmal versuchen.');
  }
  return text;
}

/** KI-Antwort → Rezept-Entwurf. Fehlende Nährwerte bleiben null („Nährwerte suchen“ im Editor). */
// ---------- Zutat im KI-Entwurf ersetzen oder rausnehmen ----------

const AI_SWAP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    ersatz: { type: 'ARRAY', items: AI_SCHEMA.properties.zutaten.items },
    zubereitung: { type: 'ARRAY', items: { type: 'STRING' } },
    hinweis: { type: 'STRING' },
  },
  required: ['name', 'ersatz', 'zubereitung', 'hinweis'],
  propertyOrdering: ['name', 'ersatz', 'zubereitung', 'hinweis'],
};

const AI_SWAP_PROMPT = `Du bist Koch und Ernährungsberater und passt ein bestehendes Rezept an. Ändere nur, was für die Anpassung nötig ist.

Antworte im vorgegebenen JSON-Schema:
- "name": Rezeptname, nur ändern, wenn die bisherige Zutat im Namen vorkam.
- "ersatz": die neue(n) Zutat(en) anstelle der betroffenen Zutat, mit Menge für ALLE Portionen. Beim Rausnehmen eine leere Liste.
  - "menge_g": Gramm im abgewogenen Zustand (roh bzw. trocken; Flüssigkeiten 1 ml = 1 g).
  - Nährwerte pro 100 g der Zutat in genau diesem Zustand, realistische Durchschnittswerte. Kohlenhydrate ohne Ballaststoffe. kcal ≈ 4 × Eiweiß + 4 × Kohlenhydrate + 9 × Fett + 2 × Ballaststoffe.
- "zubereitung": die vollständigen Arbeitsschritte, angepasst an die Änderung, ohne Nummerierung.
- "hinweis": ein kurzer Satz, was sich geändert hat (z. B. geänderte Garzeit).`;

function aiSwapPanel(i) {
  const busy = Boolean(swap.abort);
  return `
    <li class="ing-edit ai-swap" data-id="${esc(i.id)}">
      <p><b>✨ „${esc(i.name)}“ mit KI anpassen</b></p>
      <label class="field">Ersetzen durch (leer lassen: die KI schlägt etwas Passendes vor)
        <input type="text" data-swap-input value="${esc(swap.wish)}" placeholder="z. B. Hafersahne" autocomplete="off" ${busy ? 'disabled' : ''}>
      </label>
      <div class="form-actions">
        <button type="button" class="btn small primary" data-swap-replace ${busy ? 'disabled' : ''}>Ersetzen</button>
        <button type="button" class="btn small" data-swap-remove ${busy ? 'disabled' : ''}>Komplett rausnehmen</button>
        <button type="button" class="btn small" data-swap-cancel>${busy ? 'Abbrechen' : 'Schließen'}</button>
      </div>
      ${swap.status ? `<p class="status${swap.isError ? ' error' : ''}">${esc(swap.status)}</p>` : ''}
    </li>`;
}

function buildSwapPrompt(recipe, target, mode, wish) {
  const lines = [
    `Rezept: ${recipe.name || 'ohne Namen'} (${recipe.servings} ${recipe.servings === 1 ? 'Portion' : 'Portionen'})`,
    'Zutaten:',
    ...recipe.ingredients.map(i => `- ${fmt(i.grams, 1)} g ${i.name}`),
    'Zubereitung:',
    ...instructionSteps(recipe.instructions).map(step => `- ${step}`),
    '',
    mode === 'remove'
      ? `Anpassung: Nimm „${target.name}“ komplett aus dem Rezept. Keine Ersatz-Zutat.`
      : wish
        ? `Anpassung: Ersetze „${fmt(target.grams, 1)} g ${target.name}“ durch ${wish}. Wähle eine passende Menge.`
        : `Anpassung: Ersetze „${fmt(target.grams, 1)} g ${target.name}“ durch die passendste Alternative mit ähnlicher Funktion im Rezept.`,
  ];
  const rules = recipe.tags
    .filter(key => !(key === 'vegetarian' && recipe.tags.includes('vegan')))
    .map(key => `- ${TAG[key].prompt}`);
  if (rules.length) lines.push(`Das Rezept muss weiterhin diese Anforderungen erfüllen:\n${rules.join('\n')}`);
  if (state.dislikes.length) lines.push(`Verwende auf keinen Fall: ${state.dislikes.map(d => d.name).join(', ')}`);
  return lines.join('\n');
}

async function runIngredientSwap(mode) {
  if (!swap || swap.abort || !recipeDraft) return;
  const target = recipeDraft.ingredients.find(i => i.id === swap.ingredientId);
  const key = readLocal(AI_KEY_STORAGE);
  if (!target || !key) return;
  const wish = swap.wish.trim();
  const current = swap;
  current.abort = new AbortController();
  current.isError = false;
  const started = Date.now();
  const statusText = () => `Die KI passt das Rezept an … ${Math.round((Date.now() - started) / 1000)} s`;
  current.status = statusText();
  renderDraft(); // Knöpfe sperren, Status anzeigen
  const tick = () => {
    current.status = statusText();
    const status = $('#recipeIngredients .ai-swap .status');
    if (status) status.textContent = current.status;
  };
  const timer = setInterval(tick, 1000);
  const before = structuredClone(recipeDraft);

  try {
    const model = await currentAiModel(key);
    const data = await geminiFetch(`models/${model}:generateContent`, {
      key,
      signal: current.abort.signal,
      body: {
        systemInstruction: { parts: [{ text: AI_SWAP_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildSwapPrompt(recipeDraft, target, mode, wish) }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: AI_SWAP_SCHEMA },
      },
    });
    const answer = parseAiJson(geminiText(data));
    if (swap !== current || !recipeDraft) return; // Editor wurde inzwischen geschlossen oder gewechselt
    const index = recipeDraft.ingredients.findIndex(i => i.id === target.id);
    if (index < 0) throw new AiError('Die Zutat wurde inzwischen gelöscht.');
    const replacements = mode === 'remove' ? [] : parseAiIngredients(answer?.ersatz);
    if (mode === 'replace' && !replacements.length) {
      throw new AiError('Die KI hat keinen Ersatz geliefert. Bitte nochmal versuchen oder einen Ersatz vorgeben.');
    }
    const steps = instructionSteps((Array.isArray(answer?.zubereitung) ? answer.zubereitung.map(String) : []).join('\n'));

    recipeDraft.ingredients.splice(index, 1, ...replacements);
    if (steps.length) recipeDraft.instructions = steps.join('\n');
    const newName = String(answer?.name ?? '').trim();
    if (newName) recipeDraft.name = newName;
    swapResult = {
      text: mode === 'remove'
        ? `„${target.name}“ rausgenommen, Zubereitung angepasst.`
        : `„${target.name}“ ersetzt durch ${replacements.map(r => `${fmt(r.grams)} g ${r.name}`).join(' und ')}.`,
      hint: String(answer?.hinweis ?? '').trim(),
      undo: before,
    };
    swap = null;
    $('#recipeName').value = recipeDraft.name;
    $('#recipeInstructions').value = recipeDraft.instructions;
    renderDraft();
  } catch (e) {
    if (swap !== current) return;
    current.status = e.aborted ? '' : e.message;
    current.isError = !e.aborted;
    current.abort = null;
    if (e.badModel) writeLocal(AI_MODEL_STORAGE, '');
    if (e.aborted) swap = null;
    renderDraft();
  } finally {
    clearInterval(timer);
    if (swap === current) current.abort = null;
  }
}

function parseAiJson(text) {
  try {
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new AiError('Die KI hat keine gültige Antwort geliefert. Bitte nochmal versuchen.');
  }
}

/** Zutaten im KI-Schema (deutsche Feldnamen) → Entwurfs-Zutaten mit Marke „KI-Schätzung“. */
function parseAiIngredients(list) {
  const ingredients = [];
  for (const z of Array.isArray(list) ? list : []) {
    const name = String(z?.name ?? '').trim();
    const grams = toNum(z?.menge_g);
    if (!name || !(grams > 0)) continue;
    const per100 = {};
    for (const n of NUTRIENTS) {
      const v = AI_FIELDS[n.key] ? toNum(z[AI_FIELDS[n.key]]) : null;
      per100[n.key] = v !== null && v >= 0 ? round(v, 1) : null;
    }
    ingredients.push({ id: uid(), name, brand: per100.kcal === null ? '' : AI_BRAND, code: '', grams: round(grams, 1), per100 });
  }
  return ingredients;
}

function parseAiRecipe(text, servings) {
  const data = parseAiJson(text);
  const ingredients = parseAiIngredients(data?.zutaten);
  if (!ingredients.length) throw new AiError('Die KI hat keine verwertbaren Zutaten geliefert. Bitte nochmal versuchen.');
  const steps = Array.isArray(data.zubereitung) ? data.zubereitung.map(String) : [];
  return {
    id: `rec-${uid()}`,
    name: String(data.name || '').trim() || 'KI-Rezept',
    servings,
    totalWeight: null,
    ingredients,
    instructions: instructionSteps(steps.join('\n')).join('\n'),
    sourceUrl: '',
    updated: 0,
  };
}

function renderAiCard() {
  $('#aiTags').innerHTML = tagChips(currentAiTags(), 'ai-tag');
  $('#aiDislikeHint').textContent = state.dislikes.length
    ? `👎 Wird automatisch weggelassen: ${state.dislikes.map(d => d.name).join(', ')} (Liste „Mag ich nicht“ unten)`
    : '';
  $('#aiDislikeHint').hidden = !state.dislikes.length;
  const hasKey = Boolean(readLocal(AI_KEY_STORAGE));
  $('#aiSetup').hidden = hasKey;
  $('#aiMain').hidden = !hasKey;
  if (!hasKey) return;
  const rest = todaysRest();
  $('#aiBudgetLabel').textContent = `An meinem heutigen Restbudget ausrichten (noch ${fmt(rest.kcal)} kcal, ${fmt(rest.protein)} g Eiweiß fehlen)`;
  renderModelSelect();
}

function renderModelSelect() {
  const current = readLocal(AI_MODEL_STORAGE);
  const ids = [...(aiModels || [])];
  if (current && !ids.includes(current)) ids.unshift(current);
  $('#aiModel').innerHTML = [
    `<option value="">Automatisch (${esc(aiModels?.[0] || current || 'bestes Flash-Modell')})</option>`,
    ...ids.map(id => `<option value="${esc(id)}">${esc(id)}</option>`),
  ].join('');
  $('#aiModel').value = aiModels && current === aiModels[0] ? '' : current;
}

function setAiStatus(text, isError = false) {
  const el = $('#aiStatus');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

async function saveAiKey() {
  const input = $('#aiKeyInput');
  const msg = $('#aiKeyMsg');
  const key = input.value.trim().replace(/\s+/g, '');
  if (!key) return setMsg(msg, 'Bitte zuerst den API-Schlüssel einfügen.', true);
  $('#aiKeySave').disabled = true;
  setMsg(msg, 'Schlüssel wird geprüft …');
  try {
    aiModels = await geminiListModels(key); // prüft den Schlüssel und lädt die Modelle
    if (!writeLocal(AI_KEY_STORAGE, key)) return setMsg(msg, 'Der Schlüssel konnte in diesem Browser nicht gespeichert werden.', true);
    writeLocal(AI_MODEL_STORAGE, aiModels[0] || AI_FALLBACK_MODEL);
    input.value = '';
    setMsg(msg, '');
    renderAiCard();
    showToast('KI ist eingerichtet ✓');
    $('#aiPrompt').focus();
  } catch (e) {
    setMsg(msg, e.message, true);
  } finally {
    $('#aiKeySave').disabled = false;
  }
}

async function generateAiRecipe() {
  if (aiAbort) return;
  const key = readLocal(AI_KEY_STORAGE);
  if (!key) return renderAiCard();
  const servings = toNum($('#aiServings').value);
  if (!Number.isInteger(servings) || servings < 1 || servings > 20) {
    return setAiStatus('Bitte eine Portionenzahl zwischen 1 und 20 eingeben.', true);
  }

  aiAbort = new AbortController();
  $('#aiGenerate').disabled = true;
  $('#aiCancel').hidden = false;
  const started = Date.now();
  const tick = () => setAiStatus(`Die KI erstellt dein Rezept … ${Math.round((Date.now() - started) / 1000)} s (meist 10 bis 40 Sekunden)`);
  tick();
  const timer = setInterval(tick, 1000);

  try {
    const model = await currentAiModel(key);
    const data = await geminiFetch(`models/${model}:generateContent`, {
      key,
      signal: aiAbort.signal,
      body: {
        systemInstruction: { parts: [{ text: AI_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildAiUserPrompt($('#aiPrompt').value.trim(), servings, $('#aiUseBudget').checked, currentAiTags()) }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: AI_SCHEMA },
      },
    });
    const recipe = parseAiRecipe(geminiText(data), servings);
    recipe.tags = [...currentAiTags()]; // Editor prüft danach, ob die Nährwerte dazu passen
    setAiStatus('');
    aiOpen = false;
    startRecipeEdit(recipe, { fromAi: true });
    if (currentView !== 'recipes') showToast('Dein KI-Rezept ist fertig (Reiter „Rezepte“).');
  } catch (e) {
    if (e.badModel) writeLocal(AI_MODEL_STORAGE, ''); // beim nächsten Versuch neu auswählen
    setAiStatus(e.badKey ? `${e.message} Unter „KI-Einstellungen“ kannst du den Schlüssel entfernen und neu eintragen.` : e.message, !e.aborted);
  } finally {
    clearInterval(timer);
    aiAbort = null;
    $('#aiGenerate').disabled = false;
    $('#aiCancel').hidden = true;
  }
}

function bindAiEvents() {
  $('#aiTags').addEventListener('click', ev => {
    const chip = ev.target.closest('[data-ai-tag]');
    if (!chip) return;
    aiTags = toggleTag(currentAiTags(), chip.dataset.aiTag);
    writeLocal(AI_TAGS_STORAGE, JSON.stringify(aiTags));
    $('#aiTags').innerHTML = tagChips(aiTags, 'ai-tag');
  });
  $('#aiOpenBtn').addEventListener('click', () => {
    aiOpen = true;
    importOpen = false;
    renderRecipes();
    (readLocal(AI_KEY_STORAGE) ? $('#aiPrompt') : $('#aiKeyInput')).focus();
  });
  $('#importOpenBtn').addEventListener('click', () => {
    aiOpen = false; // immer nur eine der beiden Karten offen
  });
  $('#aiClose').addEventListener('click', () => {
    aiAbort?.abort();
    aiOpen = false;
    renderRecipes();
  });

  $('#aiKeySave').addEventListener('click', saveAiKey);
  $('#aiKeyInput').addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault(); // nicht das Formular (Rezept erstellen) absenden
    saveAiKey();
  });
  $('#aiKeyRemove').addEventListener('click', () => {
    if (!confirm('API-Schlüssel von diesem Gerät entfernen?')) return;
    writeLocal(AI_KEY_STORAGE, '');
    writeLocal(AI_MODEL_STORAGE, '');
    aiModels = null;
    $('#aiSettings').open = false;
    renderAiCard();
  });

  $('#aiSettings').addEventListener('toggle', async () => {
    if (!$('#aiSettings').open || aiModels) return;
    try {
      aiModels = await geminiListModels(readLocal(AI_KEY_STORAGE));
      renderModelSelect();
    } catch { /* Auswahl zeigt dann nur das aktuelle Modell */ }
  });
  $('#aiModel').addEventListener('change', ev => {
    writeLocal(AI_MODEL_STORAGE, ev.target.value || aiModels?.[0] || '');
  });

  $('#aiCard').addEventListener('submit', ev => {
    ev.preventDefault();
    generateAiRecipe();
  });
  $('#aiCancel').addEventListener('click', () => aiAbort?.abort());
}

// =====================================================================
// Kochansicht
// =====================================================================

const cookDialog = $('#cookDialog');
// Zustand bleibt erhalten, wenn dasselbe Rezept erneut geöffnet wird (z. B. nach versehentlichem Schließen)
let cook = null; // { recipeId, portions, checked: Set<Zutat-Index>, done: Set<Schritt-Index> }
let cookTimers = []; // { id, label, endAt, finished }
let cookTimerInterval = null;

/** Zeitangaben in einem Schritt („10 Minuten“, „2–3 Min.“, „1 Stunde“) → Timer-Vorschläge. Bei Spannen gilt der höhere Wert. */
function stepTimers(step) {
  const timers = [];
  const pattern = /(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|bis)\s*(\d+(?:[.,]\d+)?))?\s*(stunden?|std\.?|minuten?|min\.?|sekunden?|sek\.?)(?![a-zäöüß])/gi;
  for (const m of step.matchAll(pattern)) {
    const value = toNum(m[2] ?? m[1]);
    const unit = m[3].toLowerCase();
    const factor = unit.startsWith('st') ? 3600 : unit.startsWith('m') ? 60 : 1;
    const seconds = Math.round(value * factor);
    if (!(seconds > 0) || seconds > 24 * 3600 || timers.some(t => t.seconds === seconds)) continue;
    const label = factor === 3600 ? `${fmt(value, 1)} Std.` : factor === 60 ? `${fmt(value, 1)} Min.` : `${fmt(value)} Sek.`;
    timers.push({ seconds, label });
  }
  return timers;
}

function fmtClock(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function openCookView(recipe) {
  if (cook?.recipeId !== recipe.id) {
    cook = { recipeId: recipe.id, portions: recipe.servings > 0 ? recipe.servings : 1, checked: new Set(), done: new Set() };
  }
  renderCook();
  cookDialog.showModal();
  cookDialog.scrollTop = 0;
}

function renderCook() {
  const recipe = state.recipes[cook?.recipeId];
  if (!recipe) {
    if (cookDialog.open) cookDialog.close();
    return;
  }
  const factor = cook.portions / (recipe.servings > 0 ? recipe.servings : 1);
  const s = recipeStats(recipe);
  const p = s.perServing;
  $('#cookTitle').textContent = recipe.name;
  $('#cookMeta').textContent = `Pro Portion: ${fmt(p.kcal)} kcal · E ${fmt(p.protein, 1)} g · K ${fmt(p.carbs, 1)} g · F ${fmt(p.fat, 1)} g`;
  $('#cookPortions').textContent = `${fmt(cook.portions, 1)} ${cook.portions === 1 ? 'Portion' : 'Portionen'}`;
  $('#cookLess').disabled = cook.portions <= 0.5;

  $('#cookIngCount').textContent = recipe.ingredients.length ? `(${cook.checked.size} von ${recipe.ingredients.length} bereit)` : '';
  $('#cookIngredients').innerHTML = recipe.ingredients.map((ing, index) => `
    <li class="${cook.checked.has(index) ? 'done' : ''}">
      <label>
        <input type="checkbox" data-cook-ing="${index}" ${cook.checked.has(index) ? 'checked' : ''}>
        <span class="cook-amount">${fmtShopGrams(ing.grams * factor)}</span>
        <span>${esc(ing.name)}</span>
      </label>
    </li>`).join('');

  const steps = instructionSteps(recipe.instructions);
  const current = steps.findIndex((_, index) => !cook.done.has(index));
  $('#cookStepCount').textContent = steps.length
    ? (current < 0 ? '(alles erledigt 🎉)' : `(Schritt ${current + 1} von ${steps.length})`)
    : '';
  $('#cookSteps').innerHTML = steps.length
    ? steps.map((step, index) => `
      <li class="cook-step${cook.done.has(index) ? ' done' : ''}${index === current ? ' current' : ''}">
        <button type="button" class="cook-step-text" data-cook-step="${index}" aria-pressed="${cook.done.has(index)}">${esc(step)}</button>
        ${stepTimers(step).map(t => `
          <button type="button" class="btn small timer-btn" data-cook-timer="${t.seconds}" data-cook-label="${esc(`Schritt ${index + 1}: ${t.label}`)}">⏱ ${esc(t.label)}</button>`).join('')}
      </li>`).join('')
    : '<li class="cook-empty">Für dieses Rezept ist keine Zubereitung hinterlegt. Du kannst sie unter „Bearbeiten“ eintragen.</li>';

  const video = $('#cookVideo');
  video.hidden = !recipe.sourceUrl;
  if (recipe.sourceUrl) video.href = recipe.sourceUrl;
  renderCookTimers();
}

// ---------- Timer ----------

function renderCookTimers() {
  const box = $('#cookTimers');
  box.hidden = !cookTimers.length;
  box.innerHTML = cookTimers.map(t => `
    <div class="cook-timer${t.finished ? ' finished' : ''}" data-id="${esc(t.id)}" role="timer">
      <span>⏱ ${esc(t.label)}</span>
      <b data-timer-left>${t.finished ? 'Fertig!' : fmtClock(Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000)))}</b>
      <button type="button" class="icon-btn" data-timer-stop aria-label="Timer beenden" title="Timer beenden">✕</button>
    </div>`).join('');
}

function startCookTimer(seconds, label) {
  cookTimers.push({ id: uid(), label, endAt: Date.now() + seconds * 1000, finished: false });
  if (!cookTimerInterval) cookTimerInterval = setInterval(tickCookTimers, 500);
  renderCookTimers();
}

/** Nur die Zeiten aktualisieren (kein Neuzeichnen, sonst gehen Klicks auf ✕ verloren). */
function tickCookTimers() {
  const now = Date.now();
  let changed = false;
  for (const t of cookTimers) {
    if (!t.finished && now >= t.endAt) {
      t.finished = true;
      changed = true;
      // Im geöffneten Dialog blinkt der Timer; ist die Kochansicht zu, erscheint eine Meldung
      if (!cookDialog.open) showToast(`⏱ ${t.label} ist fertig!`);
    }
  }
  if (changed) {
    renderCookTimers();
  } else {
    for (const t of cookTimers) {
      const el = $(`#cookTimers .cook-timer[data-id="${CSS.escape(t.id)}"] [data-timer-left]`);
      if (el && !t.finished) el.textContent = fmtClock(Math.max(0, Math.ceil((t.endAt - now) / 1000)));
    }
  }
  if (!cookTimers.some(t => !t.finished)) {
    clearInterval(cookTimerInterval);
    cookTimerInterval = null;
  }
}

function bindCookEvents() {
  $('#cookClose').addEventListener('click', () => cookDialog.close());
  // Beim Kochen bewusst kein Schließen durch Tippen neben den Dialog

  $('#cookLess').addEventListener('click', () => {
    cook.portions = Math.max(0.5, cook.portions <= 1 ? cook.portions - 0.5 : cook.portions - 1);
    renderCook();
  });
  $('#cookMore').addEventListener('click', () => {
    cook.portions = cook.portions < 1 ? cook.portions + 0.5 : cook.portions + 1;
    renderCook();
  });

  $('#cookIngredients').addEventListener('change', ev => {
    const index = Number(ev.target.dataset.cookIng);
    if (Number.isNaN(index)) return;
    if (ev.target.checked) cook.checked.add(index);
    else cook.checked.delete(index);
    renderCook();
  });

  $('#cookSteps').addEventListener('click', ev => {
    const timerBtn = ev.target.closest('[data-cook-timer]');
    if (timerBtn) return startCookTimer(Number(timerBtn.dataset.cookTimer), timerBtn.dataset.cookLabel);
    const stepBtn = ev.target.closest('[data-cook-step]');
    if (!stepBtn) return;
    const index = Number(stepBtn.dataset.cookStep);
    if (cook.done.has(index)) cook.done.delete(index);
    else cook.done.add(index);
    renderCook();
  });

  $('#cookTimers').addEventListener('click', ev => {
    if (!ev.target.closest('[data-timer-stop]')) return;
    const id = ev.target.closest('.cook-timer').dataset.id;
    cookTimers = cookTimers.filter(t => t.id !== id);
    renderCookTimers();
  });

  $('#cookShare').addEventListener('click', () => {
    const recipe = state.recipes[cook?.recipeId];
    if (recipe) shareRecipe(recipe);
  });

  $('#cookLog').addEventListener('click', () => {
    const recipe = state.recipes[cook?.recipeId];
    if (!recipe) return;
    cookDialog.close();
    openDialog({ target: 'diary', title: `Eintragen: ${formatDateLabel(currentDate)}`, food: recipeAsFood(recipe) });
  });
}

// =====================================================================
// Ansicht: Einkaufsliste
// =====================================================================

const WATER_PATTERN = /^(?:wasser|leitungswasser|eiswasser|heißes wasser|kaltes wasser)\b/i;

// ---------- Vorrat („Zu Hause vorrätig“) ----------

/** Wortformen für einen einfachen Singular/Plural-Abgleich („Ei“ ↔ „Eier“, „Zwiebel“ ↔ „Zwiebeln“). */
function wordForms(word) {
  if (word.length < 3) return [word, `${word}er`]; // „Ei“ → „Eier“, aber nicht „Eis“ oder „Ein“
  return [word, `${word}n`, `${word}en`, `${word}er`, `${word}e`, `${word}s`];
}

// Oberbegriffe, die konkrete Zutaten einschließen („Pilze“ passt zu „Champignons“)
const INGREDIENT_GROUPS = [
  { words: ['pilz'], pattern: /champignon|pfifferling|steinpilz|shiitake|austernpilz|kräuterseitling|morchel|trüffel/i },
  { words: ['fisch'], pattern: /lachs|thunfisch|kabeljau|forelle|hering|makrele|sardine|sardelle|seelachs|dorsch|scholle|zander|pangasius|anchovi/i },
  { words: ['meeresfrüchte', 'meeresfrucht'], pattern: /garnele|shrimp|krabbe|muschel|tintenfisch|calamar|oktopus|hummer|scampi|krebs/i },
  { words: ['nuss', 'nüsse'], pattern: /nuss|nüsse|mandel|cashew|pistazie|pekan|macadamia/i },
  { words: ['innereien'], pattern: /leber|niere|kutteln|bries/i },
];

function nameKey(name) {
  return shoppingKey(name).replace(/\(.*?\)/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Passt ein Listeneintrag (Vorrat, „Mag ich nicht“) zu einer Zutat? Gleiches Wort (auch Plural), bei mehrteiligen
 * Einträgen die ganze Wortfolge, bei zusammengesetzten Wörtern das Wortende („Öl“ → „Olivenöl“, „Kohl“ → „Rosenkohl“)
 * oder ein Oberbegriff aus INGREDIENT_GROUPS.
 */
function nameMatches(ingredientName, entryName, { prefix = false } = {}) {
  const key = nameKey(ingredientName);
  const pk = nameKey(entryName);
  if (!key || !pk) return false;
  const words = key.split(' ');
  const group = INGREDIENT_GROUPS.find(g => g.words.some(w => w === pk || wordForms(w).includes(pk)));
  if (group && group.pattern.test(key)) return true;
  if (pk.includes(' ')) return ` ${key} `.includes(` ${pk} `);
  // Wortende: bei kurzen Einträgen nur die Grundform („Öl“ → „Olivenöl“, aber „Ei“ nicht → „Rotwein“)
  const endings = pk.length >= 3 ? wordForms(pk) : [pk];
  return words.some(w => wordForms(pk).includes(w)
    || wordForms(w).includes(pk)
    || endings.some(form => w.length > form.length && w.endsWith(form))
    // Wortanfang („Fisch“ → „Fischsauce“) nur auf Wunsch: beim Vorrat wäre „Tomaten“ ≠ „Tomatenmark“
    || (prefix && [pk, pk.replace(/(?:en|er|n|e|s)$/, '')] // auch Einzahl vorne: „Pilze“ → „Pilzfond“
      .some(stem => stem.length >= 4 && w.length > stem.length && w.startsWith(stem))));
}

function pantryMatches(name) {
  return state.pantry.filter(p => nameMatches(name, p.name));
}

function dislikeMatches(name) {
  return state.dislikes.filter(d => nameMatches(name, d.name, { prefix: true }));
}

function renderDislikes() {
  $('#dislikeList').innerHTML = state.dislikes.length
    ? state.dislikes.map(d => `
      <span class="pantry-chip" data-id="${esc(d.id)}">${esc(d.name)}
        <button type="button" class="icon-btn" data-dislike-del aria-label="${esc(d.name)} aus „Mag ich nicht“ entfernen" title="Entfernen">✕</button>
      </span>`).join('')
    : '<p class="muted">Noch nichts eingetragen.</p>';
}

function bindDislikeEvents() {
  $('#dislikeForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const input = $('#dislikeInput');
    // Mehrere auf einmal möglich: „Pilze, Koriander“
    const names = input.value.split(/[,;\n]/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!names.length) return;
    let added = 0;
    for (const name of names) {
      if (state.dislikes.some(d => d.name.toLowerCase() === name.toLowerCase())) continue;
      state.dislikes.push({ id: uid(), name });
      added++;
    }
    if (!added) {
      showToast('Steht schon auf der Liste.');
    } else {
      state.dislikes.sort((a, b) => a.name.localeCompare(b.name, 'de'));
      saveState();
    }
    input.value = '';
    renderRecipes(); // Hinweise an den Rezepten aktualisieren
    $('#dislikeInput').focus();
  });

  $('#dislikeList').addEventListener('click', ev => {
    if (!ev.target.closest('[data-dislike-del]')) return;
    const id = ev.target.closest('.pantry-chip').dataset.id;
    state.dislikes = state.dislikes.filter(d => d.id !== id);
    saveState();
    renderRecipes();
  });
}

/** Nicht gemochte Zutaten eines Rezepts: [{ ingredient, entries }] */
function recipeDislikes(recipe) {
  if (!state.dislikes.length) return [];
  return recipe.ingredients
    .map(i => ({ ingredient: i.name, entries: dislikeMatches(i.name).map(d => d.name) }))
    .filter(x => x.entries.length);
}

/** Warum eine Rezeptzutat nicht vorausgewählt ist (oder '' wenn sie auf die Liste soll). */
function shopSkipReason(name) {
  if (pantryMatches(name).length) return 'vorrätig';
  if (WATER_PATTERN.test(name)) return 'aus der Leitung';
  if (SPICES.test(name)) return 'Gewürz';
  return '';
}

function addToPantry(name) {
  const clean = cleanLine(name).replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  if (!clean || state.pantry.some(p => p.name.toLowerCase() === clean.toLowerCase())) return false;
  state.pantry.push({ id: uid(), name: clean });
  state.pantry.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  saveState();
  return true;
}

function removeFromPantry(name) {
  const ids = new Set(pantryMatches(name).map(p => p.id));
  state.pantry = state.pantry.filter(p => !ids.has(p.id));
  saveState();
}

function updateShopSubmit(form) {
  const count = $$('input[name="ing"]', form).filter(cb => cb.checked).length;
  const btn = $('[data-shop-submit]', form);
  btn.disabled = !count;
  btn.textContent = count ? `${count} ${count === 1 ? 'Zutat' : 'Zutaten'} auf die Einkaufsliste` : 'Alles vorrätig';
}

function renderPantry() {
  $('#pantryList').innerHTML = state.pantry.length
    ? state.pantry.map(p => `
      <span class="pantry-chip" data-id="${esc(p.id)}">${esc(p.name)}
        <button type="button" class="icon-btn" data-pantry-del aria-label="${esc(p.name)} aus dem Vorrat entfernen" title="Entfernen">✕</button>
      </span>`).join('')
    : '<p class="muted">Noch nichts eingetragen.</p>';
}

function bindPantryEvents() {
  $('#pantryForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const input = $('#pantryInput');
    // Mehrere auf einmal möglich: „Öl, Reis, Nudeln“
    const names = input.value.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
    if (!names.length) return;
    const added = names.filter(addToPantry).length;
    if (!added) showToast('Steht schon im Vorrat.');
    input.value = '';
    renderPantry();
    input.focus();
  });
  $('#pantryList').addEventListener('click', ev => {
    if (!ev.target.closest('[data-pantry-del]')) return;
    const id = ev.target.closest('.pantry-chip').dataset.id;
    state.pantry = state.pantry.filter(p => p.id !== id);
    saveState();
    renderPantry();
  });
}

function fmtShopGrams(g) {
  if (g >= 1000) return `${fmt(g / 1000, 2)} kg`;
  return g < 10 ? `${fmt(g, 1)} g` : `${fmt(Math.ceil(g))} g`; // aufrunden: lieber etwas mehr kaufen
}

/**
 * Schlüssel für die gemerkte Markt-Zuordnung: „2 Eier“ (von Hand) und „Eier“ (aus einem Rezept)
 * sollen im selben Markt landen.
 */
function shoppingKey(name) {
  const line = cleanLine(name);
  const parsed = parseIngredientLine(line);
  return (parsed && parsed.hadAmount ? parsed.name : line).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Fügt einen Eintrag hinzu oder rechnet ihn mit einem offenen gleichnamigen Eintrag zusammen. */
function addShoppingItem({ name, grams = null, source = '' }) {
  const key = name.trim().toLowerCase();
  const existing = state.shopping.find(i => !i.checked && i.name.toLowerCase() === key && (i.grams === null) === (grams === null));
  if (existing) {
    if (grams !== null) existing.grams = round(existing.grams + grams, 1);
    if (source && !existing.sources.includes(source)) existing.sources.push(source);
    return 'merged';
  }
  const shopId = state.shopAssignments[shoppingKey(name)] || null; // beim letzten Mal gewählten Markt vorschlagen
  state.shopping.push({
    id: uid(), name: name.trim(), grams: grams === null ? null : round(grams, 1),
    sources: source ? [source] : [], checked: false, shopId,
  });
  return 'added';
}

/** `selected`: Indizes der Zutaten, die auf die Liste sollen (Rest ist vorrätig oder abgewählt). */
function addRecipeToShopping(recipe, portions, selected) {
  const factor = portions / (recipe.servings > 0 ? recipe.servings : 1);
  let added = 0;
  let merged = 0;
  recipe.ingredients.forEach((ing, index) => {
    if (!selected.has(index)) return;
    if (addShoppingItem({ name: ing.name, grams: ing.grams * factor, source: recipe.name }) === 'merged') merged++;
    else added++;
  });
  if (!added && !merged) return;
  saveState();
  const count = added + merged;
  const skipped = recipe.ingredients.length - count;
  showToast(`${count} ${count === 1 ? 'Zutat' : 'Zutaten'} auf der Einkaufsliste${
    merged ? `, ${merged} mit vorhandenen zusammengerechnet` : ''}${skipped ? `, ${skipped} weggelassen` : ''}`);
}

/** Offene Einträge nach Markt (in der Reihenfolge der gespeicherten Märkte), zuletzt die ohne Markt. */
function shoppingGroups(items) {
  const groups = state.shops
    .map(shop => ({ shop, items: items.filter(i => i.shopId === shop.id) }))
    .filter(g => g.items.length);
  const withoutShop = items.filter(i => !i.shopId);
  if (withoutShop.length) groups.push({ shop: null, items: withoutShop });
  return groups;
}

function renderShopping() {
  const open = state.shopping.filter(i => !i.checked);
  const done = state.shopping.filter(i => i.checked);
  const shopById = Object.fromEntries(state.shops.map(shop => [shop.id, shop]));
  const grouped = open.some(i => i.shopId);

  const row = i => {
    const shop = shopById[i.shopId];
    let chip = '';
    if (!i.checked) {
      chip = shop && grouped
        ? `<button type="button" class="shop-chip set" data-shop-pick aria-label="Markt ändern" title="Markt ändern">🏪</button>`
        : `<button type="button" class="shop-chip${shop ? ' set' : ''}" data-shop-pick title="Markt wählen">🏪 ${shop ? esc(shop.name) : 'Markt'}</button>`;
    }
    return `
      <li class="shop-item${i.checked ? ' done' : ''}" data-id="${esc(i.id)}">
        <label class="shop-check">
          <input type="checkbox" data-shop-check ${i.checked ? 'checked' : ''}>
          <span class="shop-text">
            <span class="shop-name">${i.grams !== null ? `<span class="shop-amount">${fmtShopGrams(i.grams)}</span>` : ''}${esc(i.name)}</span>
            ${i.sources.length ? `<span class="shop-source">für ${i.sources.map(esc).join(', ')}</span>` : ''}
          </span>
        </label>
        ${chip}
        <button type="button" class="icon-btn del" data-shop-del aria-label="Eintrag entfernen" title="Entfernen">✕</button>
      </li>`;
  };

  const openHtml = grouped
    ? shoppingGroups(open).map(g => `
        <li class="shop-group">${g.shop
          ? `🏪 ${esc(g.shop.name)}${g.shop.detail ? ` <span class="muted">${esc(g.shop.detail)}</span>` : ''}`
          : 'Ohne Markt'}</li>
        ${g.items.map(row).join('')}`)
    : open.map(row);

  $('#shopList').innerHTML = state.shopping.length
    ? [
      ...openHtml,
      done.length ? `<li class="shop-divider">Erledigt (${done.length})</li>` : '',
      ...done.map(row),
    ].join('')
    : '<li class="empty">Die Einkaufsliste ist leer.</li>';
  $('#shopActions').hidden = !state.shopping.length;
  $('#shopClearDone').hidden = !done.length;
  $('#shopShare').hidden = !open.length;
  renderPantry();
}

function shoppingText() {
  const open = state.shopping.filter(i => !i.checked);
  const line = i => `- ${i.grams !== null ? `${fmtShopGrams(i.grams)} ` : ''}${i.name}`;
  if (!open.some(i => i.shopId)) return `Einkaufsliste\n${open.map(line).join('\n')}`;
  const sections = shoppingGroups(open)
    .map(g => `${g.shop ? g.shop.name : 'Ohne Markt'}:\n${g.items.map(line).join('\n')}`);
  return `Einkaufsliste\n\n${sections.join('\n\n')}`;
}

// ---------- Markt wählen ----------

const NEARBY_RADIUS_M = 3000;
// Suchbegriffe für Nominatim und die dazu erwarteten OpenStreetMap-Typen (im Browser getestet)
const NEARBY_QUERIES = [
  { q: 'supermarket', type: 'supermarket', label: 'Supermarkt' },
  { q: 'chemist', type: 'chemist', label: 'Drogerie' },
  { q: 'butcher', type: 'butcher', label: 'Metzgerei' },
  { q: 'bakery', type: 'bakery', label: 'Bäckerei' },
  { q: 'greengrocer', type: 'greengrocer', label: 'Obst & Gemüse' },
  { q: 'Getränkemarkt', type: 'beverages', label: 'Getränkemarkt' },
];
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_GAP_MS = 1100; // Nutzungsregeln von Nominatim: höchstens eine Anfrage pro Sekunde

const shopDialog = $('#shopPicker');
let pickerItemId = null;
let nearby = null; // { label, results: [{ osm, name, type, street, distance }] } – nur für diese Sitzung
let nearbySeq = 0;

class OsmError extends Error {}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function nominatim(params) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${NOMINATIM_BASE}?${new URLSearchParams({ format: 'jsonv2', 'accept-language': 'de', ...params })}`, { signal: ctrl.signal });
    if (res.status === 429) throw new OsmError('Zu viele Suchanfragen an OpenStreetMap. Bitte eine Minute warten.');
    if (!res.ok) throw new OsmError(`OpenStreetMap meldet einen Fehler (${res.status}). Bitte später nochmal versuchen.`);
    return await res.json();
  } catch (e) {
    if (e instanceof OsmError) throw e;
    if (ctrl.signal.aborted) throw new OsmError('OpenStreetMap antwortet gerade nicht. Bitte später nochmal versuchen.');
    throw new OsmError(navigator.onLine ? 'OpenStreetMap ist nicht erreichbar.' : 'Keine Internetverbindung.');
  } finally {
    clearTimeout(timer);
  }
}

function distanceM(lat1, lon1, lat2, lon2) {
  const rad = x => (x * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

function fmtDistance(m) {
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${fmt(m / 1000, 1)} km`;
}

async function geocodeAddress(text) {
  const [hit] = await nominatim({ q: text, limit: '1', countrycodes: 'de,at,ch' });
  if (!hit) return null;
  const label = String(hit.display_name || text).split(',').slice(0, 3).map(s => s.trim()).join(', ');
  return { label, lat: Number(hit.lat), lon: Number(hit.lon) };
}

/** Sucht nacheinander (Nominatim erlaubt keine parallelen Anfragen) und meldet Zwischenstände. */
async function searchNearbyShops({ lat, lon }, onProgress) {
  const dLat = NEARBY_RADIUS_M / 111320;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  const viewbox = `${lon - dLon},${lat + dLat},${lon + dLon},${lat - dLat}`;
  const found = new Map();
  let failures = 0;
  for (const [index, query] of NEARBY_QUERIES.entries()) {
    if (index) await wait(NOMINATIM_GAP_MS);
    let hits;
    try {
      hits = await nominatim({ q: query.q, viewbox, bounded: '1', limit: '40', addressdetails: '1' });
    } catch (e) {
      failures++;
      if (failures === NEARBY_QUERIES.length || /Zu viele/.test(e.message)) throw e;
      continue;
    }
    for (const hit of hits) {
      if (hit.category !== 'shop' || hit.type !== query.type) continue;
      const distance = distanceM(lat, lon, Number(hit.lat), Number(hit.lon));
      if (distance > NEARBY_RADIUS_M) continue;
      const address = hit.address || {};
      const street = [address.road || address.pedestrian, address.house_number].filter(Boolean).join(' ');
      const name = String(hit.name || '').trim() || query.label;
      const osm = `${hit.osm_type}/${hit.osm_id}`;
      const key = `${name.toLowerCase()}|${street.toLowerCase()}`; // gleicher Markt als Punkt und Gebäude eingetragen
      const existing = found.get(key);
      if (!existing || distance < existing.distance) found.set(key, { osm, name, type: query.label, street, distance });
    }
    onProgress?.([...found.values()].sort((a, b) => a.distance - b.distance), index + 1 < NEARBY_QUERIES.length);
  }
  return [...found.values()].sort((a, b) => a.distance - b.distance);
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new OsmError('Dein Browser kann den Standort nicht bestimmen. Gib stattdessen eine Adresse ein.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => reject(new OsmError(err.code === 1
        ? 'Der Standortzugriff wurde nicht erlaubt. Erlaube ihn in den Browser-Einstellungen oder gib eine Adresse ein.'
        : 'Der Standort konnte nicht bestimmt werden. Gib stattdessen eine Adresse ein.')),
      { timeout: 15000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

function setPickerStatus(text, isError = false) {
  const el = $('#pickerStatus');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function pickerItem() {
  return state.shopping.find(i => i.id === pickerItemId);
}

function openShopPicker(item) {
  pickerItemId = item.id;
  $('#pickerTitle').textContent = `Wo kaufst du „${item.name}“?`;
  $('#pickerAddress').value = state.shopLocation?.label || '';
  $('#pickerOwnName').value = '';
  if (!nearby) setPickerStatus('');
  renderPicker();
  shopDialog.showModal();
  if (!nearby && state.shopLocation) runNearbySearch(state.shopLocation);
}

function renderPicker() {
  const item = pickerItem();
  const current = item?.shopId || null;
  $('#pickerMineEmpty').hidden = state.shops.length > 0;
  $('#pickerShops').innerHTML = [
    ...state.shops.map(shop => `
      <li class="picker-row">
        <button type="button" class="result${shop.id === current ? ' current' : ''}" data-pick-shop="${esc(shop.id)}">
          <span class="result-name">${esc(shop.name)}${shop.id === current ? ' ✓' : ''}</span>
          ${shop.detail ? `<span class="result-meta">${esc(shop.detail)}</span>` : ''}
        </button>
        <button type="button" class="icon-btn del" data-remove-shop="${esc(shop.id)}" aria-label="Markt aus deiner Liste entfernen" title="Aus deinen Märkten entfernen">✕</button>
      </li>`),
    state.shops.length ? `
      <li class="picker-row">
        <button type="button" class="result${current ? '' : ' current'}" data-pick-shop="">
          <span class="result-name">Ohne Markt${current ? '' : ' ✓'}</span>
        </button>
      </li>` : '',
  ].join('');
  renderNearbyList();
}

function renderNearbyList() {
  const typeField = $('#pickerTypeField');
  if (!nearby || !nearby.results.length) {
    $('#pickerNearby').innerHTML = '';
    typeField.hidden = true;
    return;
  }
  // Filter nach Art; nur Arten anbieten, die gefunden wurden
  const select = $('#pickerType');
  const chosen = select.value;
  const counts = {};
  for (const r of nearby.results) counts[r.type] = (counts[r.type] || 0) + 1;
  select.innerHTML = [`<option value="">Alle (${nearby.results.length})</option>`,
    ...NEARBY_QUERIES.filter(q => counts[q.label]).map(q => `<option value="${esc(q.label)}">${esc(q.label)} (${counts[q.label]})</option>`),
  ].join('');
  select.value = counts[chosen] ? chosen : '';
  typeField.hidden = false;

  const saved = new Set(state.shops.map(shop => shop.osm).filter(Boolean));
  const shown = nearby.results
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => !select.value || r.type === select.value)
    .slice(0, 40);
  $('#pickerNearby').innerHTML = shown.map(({ r, index }) => `
    <li>
      <button type="button" class="result" data-nearby="${index}">
        <span class="result-name">${esc(r.name)}${saved.has(r.osm) ? ' <span class="muted">(gespeichert)</span>' : ''}</span>
        <span class="result-meta">${esc([r.type, r.street, fmtDistance(r.distance)].filter(Boolean).join(' · '))}</span>
      </button>
    </li>`).join('');
}

async function runNearbySearch(location) {
  const seq = ++nearbySeq;
  const buttons = [$('#pickerAddressBtn'), $('#pickerGps')];
  buttons.forEach(b => { b.disabled = true; });
  nearby = null;
  renderNearbyList();
  setPickerStatus('Suche Märkte in der Nähe …');
  try {
    const results = await searchNearbyShops(location, (partial, more) => {
      if (seq !== nearbySeq) return;
      nearby = { label: location.label, results: partial };
      renderNearbyList();
      if (more) setPickerStatus(`Suche Märkte in der Nähe … (${partial.length} gefunden)`);
    });
    if (seq !== nearbySeq) return;
    nearby = { label: location.label, results };
    renderNearbyList();
    setPickerStatus(results.length
      ? `${results.length} Märkte im Umkreis von ${fmtDistance(NEARBY_RADIUS_M)} um ${location.label}`
      : `Keine Märkte im Umkreis von ${fmtDistance(NEARBY_RADIUS_M)} gefunden. Trag deinen Markt unten selbst ein.`);
  } catch (e) {
    if (seq === nearbySeq) setPickerStatus(e.message, true);
  } finally {
    if (seq === nearbySeq) buttons.forEach(b => { b.disabled = false; });
  }
}

/** Ordnet den Eintrag (und offene Einträge mit derselben Zutat) einem Markt zu und merkt sich das. */
function assignShop(shopId) {
  const item = pickerItem();
  if (!item) return;
  const key = shoppingKey(item.name);
  for (const i of state.shopping) {
    if (i.id === item.id || (!i.checked && shoppingKey(i.name) === key)) i.shopId = shopId || null;
  }
  if (shopId) state.shopAssignments[key] = shopId;
  else delete state.shopAssignments[key];
  saveState();
  shopDialog.close();
  renderShopping();
}

function removeShop(shopId) {
  const shop = state.shops.find(s => s.id === shopId);
  if (!shop || !confirm(`„${shop.name}“ aus deinen Märkten entfernen?\n\nEinträge dieses Markts stehen danach unter „Ohne Markt“.`)) return;
  state.shops = state.shops.filter(s => s.id !== shopId);
  for (const i of state.shopping) if (i.shopId === shopId) i.shopId = null;
  for (const [key, id] of Object.entries(state.shopAssignments)) if (id === shopId) delete state.shopAssignments[key];
  saveState();
  renderPicker();
  renderShopping();
}

function bindShopPickerEvents() {
  $('#pickerClose').addEventListener('click', () => shopDialog.close());
  shopDialog.addEventListener('click', ev => { if (ev.target === shopDialog) shopDialog.close(); });

  $('#pickerShops').addEventListener('click', ev => {
    const remove = ev.target.closest('[data-remove-shop]');
    if (remove) return removeShop(remove.dataset.removeShop);
    const pick = ev.target.closest('[data-pick-shop]');
    if (pick) assignShop(pick.dataset.pickShop);
  });

  $('#pickerNearby').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-nearby]');
    const result = btn && nearby?.results[Number(btn.dataset.nearby)];
    if (!result) return;
    let shop = state.shops.find(s => s.osm === result.osm);
    if (!shop) {
      shop = { id: uid(), name: result.name, detail: [result.type, result.street].filter(Boolean).join(' · '), osm: result.osm };
      state.shops.push(shop);
    }
    assignShop(shop.id);
  });

  $('#pickerType').addEventListener('change', renderNearbyList);

  $('#pickerAddressForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const text = $('#pickerAddress').value.trim();
    if (!text) return setPickerStatus('Bitte eine Adresse oder Postleitzahl eingeben.', true);
    $('#pickerAddressBtn').disabled = true;
    setPickerStatus('Suche Adresse …');
    try {
      const location = await geocodeAddress(text);
      if (!location) {
        setPickerStatus('Die Adresse wurde nicht gefunden. Probiere es z. B. mit Straße und Ort oder nur mit der Postleitzahl.', true);
        $('#pickerAddressBtn').disabled = false;
        return;
      }
      state.shopLocation = location;
      saveState();
      $('#pickerAddress').value = location.label;
      await wait(NOMINATIM_GAP_MS);
      await runNearbySearch(location);
    } catch (e) {
      setPickerStatus(e.message, true);
      $('#pickerAddressBtn').disabled = false;
    }
  });

  $('#pickerGps').addEventListener('click', async () => {
    $('#pickerGps').disabled = true;
    setPickerStatus('Bestimme deinen Standort …');
    try {
      const position = await currentPosition();
      await runNearbySearch({ ...position, label: 'deinen aktuellen Standort' });
    } catch (e) {
      setPickerStatus(e.message, true);
      $('#pickerGps').disabled = false;
    }
  });

  $('#pickerOwnForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const name = $('#pickerOwnName').value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    let shop = state.shops.find(s => !s.osm && s.name.toLowerCase() === name.toLowerCase());
    if (!shop) {
      shop = { id: uid(), name, detail: '', osm: '' };
      state.shops.push(shop);
    }
    assignShop(shop.id);
  });
}

function bindShoppingEvents() {
  $('#shopForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const input = $('#shopInput');
    const name = input.value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    // Von Hand bleibt der Text so, wie er eingegeben wurde („2 Eier“, „500 g Hackfleisch“)
    if (addShoppingItem({ name }) === 'merged') showToast(`„${name}“ steht schon auf der Liste.`);
    input.value = '';
    saveState();
    renderShopping();
    input.focus();
  });

  $('#shopList').addEventListener('change', ev => {
    if (!ev.target.matches('[data-shop-check]')) return;
    const item = state.shopping.find(i => i.id === ev.target.closest('.shop-item').dataset.id);
    if (!item) return;
    item.checked = ev.target.checked;
    saveState();
    renderShopping();
  });

  $('#shopList').addEventListener('click', ev => {
    if (ev.target.closest('[data-shop-pick]')) {
      const item = state.shopping.find(i => i.id === ev.target.closest('.shop-item').dataset.id);
      if (item) openShopPicker(item);
      return;
    }
    if (!ev.target.closest('[data-shop-del]')) return;
    const id = ev.target.closest('.shop-item').dataset.id;
    state.shopping = state.shopping.filter(i => i.id !== id);
    saveState();
    renderShopping();
  });

  $('#shopClearDone').addEventListener('click', () => {
    state.shopping = state.shopping.filter(i => !i.checked);
    saveState();
    renderShopping();
  });

  $('#shopClearAll').addEventListener('click', () => {
    if (!confirm('Die ganze Einkaufsliste leeren?')) return;
    state.shopping = [];
    saveState();
    renderShopping();
  });

  // Handy: Teilen-Menü (WhatsApp, Notizen …); PC: in die Zwischenablage kopieren
  $('#shopShare').addEventListener('click', async () => {
    const text = shoppingText();
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Einkaufsliste', text });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('Einkaufsliste in die Zwischenablage kopiert');
    } catch {
      showToast('Teilen ist in diesem Browser nicht möglich.', true);
    }
  });
}

// =====================================================================
// Ansicht: Ziele
// =====================================================================

function renderGoals() {
  for (const n of NUTRIENTS) $(`#goal-${n.key}`).value = state.goals[n.key];
  setMsg($('#goalsMsg'), '');
}

function bindGoalEvents() {
  $('#goalsForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const goals = {};
    for (const n of NUTRIENTS) {
      const v = toNum($(`#goal-${n.key}`).value);
      if (v === null || v <= 0) return setMsg($('#goalsMsg'), `Bitte für „${n.label}“ einen Wert größer als 0 eingeben.`, true);
      goals[n.key] = v;
    }
    state.goals = goals;
    if (saveState()) setMsg($('#goalsMsg'), 'Gespeichert ✓');
  });
}

// =====================================================================
// Ansicht: Daten
// =====================================================================

function renderData() {
  const foods = Object.values(state.foods).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const dayCount = Object.keys(state.diary).length;
  const entryCount = Object.values(state.diary).reduce((sum, list) => sum + list.length, 0);
  const recipeCount = Object.keys(state.recipes).length;
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  $('#dataStats').textContent = [
    count(dayCount, 'Tag mit Einträgen', 'Tage mit Einträgen'),
    count(entryCount, 'Eintrag', 'Einträge'),
    count(foods.length, 'gespeichertes Produkt', 'gespeicherte Produkte'),
    count(recipeCount, 'Rezept', 'Rezepte'),
    count(Object.values(state.activities).reduce((sum, list) => sum + list.length, 0), 'Sporteintrag', 'Sporteinträge'),
  ].join(' · ');
  $('#foodList').innerHTML = foods.length
    ? `<ul class="food-list">${foods.map(f => `
        <li>
          <div>
            <div>${esc(f.name)}</div>
            <div class="muted small">${f.brand ? `${esc(f.brand)} · ` : ''}${fmt(f.per100.kcal)} kcal / 100 g</div>
          </div>
          <button type="button" class="icon-btn del" data-del-food="${esc(f.id)}" aria-label="Produkt entfernen" title="Aus der Liste entfernen">✕</button>
        </li>`).join('')}</ul>`
    : '<p class="muted">Noch keine Produkte gespeichert.</p>';
}

function bindDataEvents() {
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kalorien-tracker-backup-${today()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg($('#dataMsg'), 'Backup wurde heruntergeladen.');
  });

  // Teilen-Menü des Handys (z. B. an Gmail, Drive, WhatsApp). Chrome erlaubt dort kein .json, daher .txt;
  // der Import liest die Datei trotzdem, weil der Inhalt geprüft wird und nicht die Endung.
  const backupFile = () => new File([JSON.stringify(state, null, 2)], `kalorien-tracker-backup-${today()}.txt`, { type: 'text/plain' });
  $('#shareBtn').hidden = !navigator.canShare?.({ files: [backupFile()] });
  $('#shareBtn').addEventListener('click', async () => {
    try {
      await navigator.share({ files: [backupFile()], title: 'Kalorien-Tracker Backup' });
      setMsg($('#dataMsg'), 'Backup geteilt.');
    } catch (e) {
      if (e.name !== 'AbortError') setMsg($('#dataMsg'), `Teilen fehlgeschlagen: ${e.message}`, true);
    }
  });

  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const imported = normalizeState(JSON.parse(await file.text()));
      const days = Object.keys(imported.diary).length;
      if (!confirm(`Backup mit ${days} Tagen laden?\n\nDeine aktuellen Daten werden dabei vollständig ersetzt.`)) return;
      state = imported;
      recipeDraft = null;
      if (saveState()) setMsg($('#dataMsg'), `Backup importiert (${days} Tage).`);
      renderData();
    } catch (e) {
      const reason = e instanceof SyntaxError ? 'Die Datei ist kein Backup des Kalorien-Trackers.' : e.message;
      setMsg($('#dataMsg'), `Import fehlgeschlagen: ${reason}`, true);
    }
  });

  $('#foodList').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-del-food]');
    if (!btn) return;
    delete state.foods[btn.dataset.delFood];
    saveState();
    renderData();
  });

  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Wirklich ALLE Einträge, Produkte und Ziele löschen?\n\nDas kann nicht rückgängig gemacht werden. Exportiere vorher ein Backup, falls du die Daten noch brauchst.')) return;
    state = defaultState();
    recipeDraft = null;
    currentDate = today();
    if (saveState()) setMsg($('#dataMsg'), 'Alle Daten wurden gelöscht.');
    renderData();
  });
}

// =====================================================================
// Start
// =====================================================================

function buildNutrientInputs(container, idPrefix) {
  container.innerHTML = NUTRIENTS.map(n => `
    <label class="field">${esc(n.label)} (${n.unit})
      <input type="number" id="${idPrefix}-${n.key}" min="0" step="any" inputmode="decimal">
    </label>`).join('');
}

function init() {
  buildNutrientInputs($('#goalsFields'), 'goal');
  buildNutrientInputs($('#manualFields'), 'man');
  $('#mealSelect').innerHTML = MEALS.map(m => `<option value="${m.key}">${esc(m.label)}</option>`).join('');

  $$('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));
  $('#rangeSeg').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-range]');
    if (!btn) return;
    historyRange = Number(btn.dataset.range);
    renderHistory();
  });

  bindDayEvents();
  bindSportEvents();
  bindDialogEvents();
  bindRecipeEvents();
  bindImportEvents();
  bindAiEvents();
  bindShoppingEvents();
  bindShopPickerEvents();
  bindPantryEvents();
  bindDislikeEvents();
  bindCookEvents();
  bindGoalEvents();
  bindDataEvents();

  // Änderungen aus einem zweiten Browser-Tab übernehmen
  window.addEventListener('storage', ev => {
    if (ev.key !== STORAGE_KEY) return;
    state = loadState();
    RENDERERS[currentView]();
  });

  if (storageWarning) {
    $('#storageBanner').textContent = storageWarning;
    $('#storageBanner').hidden = false;
  }
  showView('day');

  // Installierbar/offline nur über http(s), z. B. GitHub Pages – unter file:// gibt es keinen Service Worker
  if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service Worker nicht registriert:', e));
    // Bittet den Browser, die Daten nicht bei Speicherknappheit zu löschen
    navigator.storage?.persist?.();
  }
}

init();

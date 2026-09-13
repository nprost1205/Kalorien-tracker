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
];

const DEFAULT_GOALS = { kcal: 2000, protein: 100, carbs: 250, fat: 70, fiber: 30 };

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
  return { version: 1, goals: { ...DEFAULT_GOALS }, foods: {}, recipes: {}, diary: {}, activities: {} };
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
    updated: toNum(r.updated) || 0,
  };
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
  return { version: 1, goals, foods, recipes, diary, activities };
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
  const goal = state.goals.kcal + burned;
  const rest = goal - t.kcal;
  const restText = rest >= 0 ? `Noch ${fmt(rest)} kcal übrig` : `${fmt(-rest)} kcal über dem Ziel`;
  const sportText = burned
    ? ` · <span class="sport-info">Ziel inkl. ${fmt(burned)} kcal Sport (${fmt(state.goals.kcal)} + ${fmt(burned)})</span>`
    : '';
  $('#summary').innerHTML = `
    <div>
      ${progressRow('kcal', t.kcal, 'big', goal)}
      <div class="kcal-rest">${restText}${sportText}</div>
    </div>
    <div class="prog-grid">
      ${['protein', 'carbs', 'fat', 'fiber'].map(k => progressRow(k, t[k])).join('')}
    </div>`;
}

function renderMeals(entries) {
  $('#meals').innerHTML = MEALS.map(meal => {
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
  return `
    <li class="entry" data-id="${esc(e.id)}">
      <div class="entry-main">
        <div class="entry-name">${esc(e.name)}${e.brand ? ` <span class="muted">· ${esc(e.brand)}</span>` : ''}</div>
        <div class="entry-macros muted">E ${fmt(c.protein, 1)} g · K ${fmt(c.carbs, 1)} g · F ${fmt(c.fat, 1)} g</div>
      </div>
      <label class="grams"><input type="number" min="0" step="any" value="${e.grams}" data-${prefix}grams aria-label="Menge in Gramm"> g</label>
      <div class="entry-kcal">${fmt(c.kcal)} kcal</div>
      <div class="entry-actions">
        ${prefix ? `<button type="button" class="icon-btn" data-${prefix}edit aria-label="Zutat bearbeiten" title="Name und Nährwerte bearbeiten">✎</button>` : ''}
        <button type="button" class="icon-btn del" data-${prefix}del aria-label="${what} entfernen" title="Entfernen">✕</button>
      </div>
    </li>`;
}

function renderSport() {
  const acts = state.activities[currentDate] || [];
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
      : '<p class="hint">Hier eingetragene Kalorien erhöhen dein Kalorienziel für diesen Tag.</p>'}
    <form class="sport-form" novalidate>
      <input type="text" name="name" list="sportNames" placeholder="Aktivität, z. B. Joggen 30 min" aria-label="Aktivität" autocomplete="off">
      <input type="number" name="kcal" min="1" step="1" placeholder="kcal" aria-label="Verbrannte Kalorien" inputmode="numeric">
      <button type="submit" class="btn small primary">Eintragen</button>
    </form>
    <datalist id="sportNames">${[...known.keys()].map(name => `<option value="${esc(name)}">`).join('')}</datalist>`;
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
    showToast(`${name}: ${fmt(kcal)} kcal eingetragen, dein Ziel steigt entsprechend`);
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

  $('#meals').addEventListener('click', ev => {
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

  $('#meals').addEventListener('change', ev => {
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

// =====================================================================
// Dialog: Lebensmittel hinzufügen
// =====================================================================

const dialog = $('#addDialog');
let dialogTarget = 'diary'; // 'diary' = ins Tagebuch, 'recipe' = Zutat für den Rezept-Entwurf
let dialogMeal = 'fruehstueck';
let selectedFood = null;
let searchResults = [];
let searchSeq = 0;

/** Öffnet den Dialog. Mit `food` geht es direkt zur Mengeneingabe (z. B. „Rezept eintragen“). */
function openDialog({ target, title, meal = guessMeal(), food = null }) {
  dialogTarget = target;
  dialogMeal = meal;
  selectedFood = null;
  $('#dlgTitle').textContent = title;
  $('#stepPick').hidden = false;
  $('#stepAmount').hidden = true;
  $('#recentFilter').value = '';
  $('#recipeFilter').value = '';
  $('#manualForm').reset();
  setMsg($('#manualMsg'), '');
  $('#pickTabs [data-pick="recipes"]').hidden = target === 'recipe'; // keine Rezepte in Rezepten
  $('#mealField').hidden = target === 'recipe';
  $('#confirmAdd').textContent = target === 'recipe' ? 'Zum Rezept hinzufügen' : 'Hinzufügen';
  renderRecent();
  renderRecipePick();
  dialog.showModal();
  setPickTab(food ? 'recipes' : Object.keys(state.foods).length ? 'recent' : 'online');
  if (food) selectFood(food);
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
  $('#gramsInput').value = food.servingG || 100;
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
  $('#averages').innerHTML = `
    <p class="muted">Durchschnitt der ${logged.length} von ${days.length} Tagen, an denen du etwas eingetragen hast.${
      avgBurned ? ` An diesen Tagen hast du im Schnitt ${fmt(avgBurned)} kcal beim Sport verbrannt, das ist im Kalorienziel enthalten.` : ''}</p>
    <table class="nut-table">
      <thead><tr><th>Nährstoff</th><th>Ø pro Tag</th><th>Ziel</th><th>Erreicht</th></tr></thead>
      <tbody>
        ${NUTRIENTS.map(n => {
          const goal = n.key === 'kcal' ? state.goals.kcal + avgBurned : state.goals[n.key];
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
let editingIngredientId = null;

function renderRecipes() {
  $('#recipeList').hidden = !!recipeDraft;
  $('#recipeEditor').hidden = !recipeDraft;
  if (recipeDraft) return renderRecipeEditor();
  const recipes = Object.values(state.recipes).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  $('#recipeItems').innerHTML = recipes.length
    ? `<ul class="recipe-items">${recipes.map(recipeRow).join('')}</ul>`
    : '<p class="muted">Noch keine Rezepte. Lege ein Gericht aus mehreren Zutaten an und trage es danach mit wenigen Klicks als Portion ein.</p>';
}

function recipeRow(r) {
  const s = recipeStats(r);
  const p = s.perServing;
  const steps = instructionSteps(r.instructions);
  return `
    <li class="recipe-item" data-id="${esc(r.id)}">
      <div class="recipe-info">
        <div class="recipe-name">${esc(r.name)}</div>
        <div class="recipe-meta">${fmt(s.servings, 1)} ${s.servings === 1 ? 'Portion' : 'Portionen'} à ${fmt(s.servingG)} g · ${r.ingredients.length} ${r.ingredients.length === 1 ? 'Zutat' : 'Zutaten'}</div>
        <div class="recipe-meta">Pro Portion: <b>${fmt(p.kcal)} kcal</b> · E ${fmt(p.protein, 1)} g · K ${fmt(p.carbs, 1)} g · F ${fmt(p.fat, 1)} g</div>
        <details class="recipe-details">
          <summary>Zutaten${steps.length ? ' &amp; Zubereitung' : ''}</summary>
          <ul>${r.ingredients.map(i => `<li>${fmt(i.grams)} g ${esc(i.name)}</li>`).join('')}</ul>
          ${steps.length ? `<ol>${steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>` : ''}
        </details>
      </div>
      <div class="recipe-actions">
        <button type="button" class="btn small primary" data-recipe-log>Eintragen</button>
        <button type="button" class="btn small" data-recipe-edit>Bearbeiten</button>
        <button type="button" class="icon-btn del" data-recipe-del aria-label="Rezept löschen" title="Löschen">✕</button>
      </div>
    </li>`;
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

function startRecipeEdit(recipe) {
  recipeDraft = recipe
    ? structuredClone(recipe)
    : { id: `rec-${uid()}`, name: '', servings: 1, totalWeight: null, ingredients: [], instructions: '', updated: 0 };
  editingIngredientId = null;
  renderRecipes();
  $('#recipeName').focus();
}

function closeRecipeEditor() {
  recipeDraft = null;
  editingIngredientId = null;
  renderRecipes();
}

function renderRecipeEditor() {
  $('#recipeEditorTitle').textContent = state.recipes[recipeDraft.id] ? 'Rezept bearbeiten' : 'Neues Rezept';
  $('#recipeName').value = recipeDraft.name;
  $('#recipeServings').value = recipeDraft.servings ?? '';
  $('#recipeWeight').value = recipeDraft.totalWeight ?? '';
  $('#recipeInstructions').value = recipeDraft.instructions ?? '';
  setMsg($('#recipeMsg'), '');
  renderDraft();
}

function renderDraft() {
  const items = recipeDraft.ingredients;
  $('#recipeIngredients').innerHTML = items.length
    ? items.map(i => itemRow(i, 'ing-') + (i.id === editingIngredientId ? ingredientEditor(i) : '')).join('')
    : '<li class="empty">Noch keine Zutaten.</li>';

  const implausible = items.filter(i => !nutrientsPlausible(i.per100));
  for (const i of implausible) $(`#recipeIngredients .entry[data-id="${CSS.escape(i.id)}"]`)?.classList.add('warn');
  $('#recipeNote').innerHTML = implausible.length
    ? `<p>⚠ Bitte prüfen (✎), die Kalorien passen nicht zu Eiweiß, Kohlenhydraten und Fett: ${implausible.map(i => esc(i.name)).join(', ')}</p>`
    : '';
  $('#recipeNote').hidden = !implausible.length;
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
  editingIngredientId = null;
  renderDraft();
}

function renderDraftNutrition() {
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

  $('#recipeItems').addEventListener('click', ev => {
    const li = ev.target.closest('.recipe-item');
    const recipe = li && state.recipes[li.dataset.id];
    if (!recipe) return;
    if (ev.target.closest('[data-recipe-log]')) {
      openDialog({ target: 'diary', title: `Eintragen: ${formatDateLabel(currentDate)}`, food: recipeAsFood(recipe) });
    } else if (ev.target.closest('[data-recipe-edit]')) {
      startRecipeEdit(recipe);
    } else if (ev.target.closest('[data-recipe-del]')) {
      if (!confirm(`Rezept „${recipe.name}“ löschen?\n\nBereits eingetragene Mahlzeiten bleiben erhalten.`)) return;
      delete state.recipes[recipe.id];
      saveState();
      renderRecipes();
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

  $('#recipeIngredients').addEventListener('click', ev => {
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
      renderDraft();
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
    const box = ev.target.closest('.ing-edit');
    if (box) applyIngredientEdit(box);
    else ev.target.blur(); // löst „change“ der Mengeneingabe aus
  });
  $('#recipeIngredients').addEventListener('change', ev => {
    if (!ev.target.matches('[data-ing-grams]')) return;
    const ingredient = recipeDraft.ingredients.find(i => i.id === ev.target.closest('.entry').dataset.id);
    const grams = toNum(ev.target.value);
    if (ingredient && grams !== null && grams > 0) {
      ingredient.grams = grams;
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
    d.instructions = d.instructions.trim();
    state.recipes[d.id] = { ...d, updated: Date.now() };
    if (!saveState()) return;
    closeRecipeEditor();
    showToast(`Rezept „${d.name}“ gespeichert`);
  });

  $('#cancelRecipeBtn').addEventListener('click', () => {
    if (isDraftDirty() && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
    closeRecipeEditor();
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

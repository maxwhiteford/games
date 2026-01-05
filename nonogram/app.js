/* Nonogram (Generated-only)
   - No static puzzles, no puzzles.json
   - Difficulty presets + seeded procedural generation
   - Recent generated puzzles list (localStorage)
   - Drag painting (pointer events) via elementFromPoint hit-testing
   - Undo/Redo (stroke grouped)
   - Reset/Check + solved detection
   - LocalStorage persistence per puzzle
   - Compact row clue gutter via --rowClueW (pairs with your styles.css)
*/

const els = {
  puzzleSelect: document.getElementById("puzzleSelect"),
  btnNew: document.getElementById("btnNew"),
  btnReset: document.getElementById("btnReset"),
  btnCheck: document.getElementById("btnCheck"),
  toolFill: document.getElementById("toolFill"),
  toolMark: document.getElementById("toolMark"),
  btnUndo: document.getElementById("btnUndo"),
  btnRedo: document.getElementById("btnRedo"),
  grid: document.getElementById("ngGrid"),
  rowClues: document.getElementById("ngRowClues"),
  colClues: document.getElementById("ngColClues"),
  corner: document.getElementById("ngCorner"),
  status: document.getElementById("ngStatus"),
  subtitle: document.getElementById("ngSubtitle"),
};

const STORAGE_PREFIX = "cf-nonogram:v3:"; // bumped due to generated-only model
const STORAGE_RECENTS = "cf-nonogram:recents:v1";

// Current puzzle meta
// { id, name, difficulty, size, seed, bitsB64 }
let currentMeta = null;

// State: 0 empty, 1 filled, 2 marked
let size = 10;
let solution = []; // 0/1 bits (size*size)
let state = [];    // 0/1/2 (size*size)

let tool = "fill"; // "fill" | "mark"
let isPointerDown = false;
let strokeChanges = null; // Map index -> {from,to}
let paintTo = null;

let undoStack = [];
let redoStack = [];

/* -------------------- Difficulty presets -------------------- */
const PRESETS = [
  { id: "preset-easy",   label: "Easy (5×5)",     difficulty: "easy",   n: 5,  density: 0.38, sym: "hv" },
  { id: "preset-medium", label: "Medium (10×10)", difficulty: "medium", n: 10, density: 0.46, sym: "v"  },
  { id: "preset-hard",   label: "Hard (15×15)",   difficulty: "hard",   n: 15, density: 0.53, sym: "none" },
  { id: "preset-expert", label: "Expert (20×20)", difficulty: "expert", n: 20, density: 0.58, sym: "none" },
];

/* -------------------- Utilities -------------------- */
function setStatus(msg) { els.status.textContent = msg; }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function puzzleKey(puzzleId) { return `${STORAGE_PREFIX}${puzzleId}`; }

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// bits <-> base64url (compact for recents)
function bitsToB64(bits) {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= (1 << (i & 7));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64ToBits(b64, totalBits) {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const bits = new Array(totalBits).fill(0);
  for (let i = 0; i < totalBits; i++) bits[i] = (bytes[i >> 3] >> (i & 7)) & 1;
  return bits;
}

/* -------------------- Puzzle generation -------------------- */
function generateBits(n, density, symmetry, rng) {
  const bits = new Array(n * n).fill(0);
  const setBit = (r, c, v) => { bits[r * n + c] = v ? 1 : 0; };

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (symmetry === "v" && c > Math.floor((n - 1) / 2)) continue;
      if (symmetry === "h" && r > Math.floor((n - 1) / 2)) continue;
      if (symmetry === "hv" && (r > Math.floor((n - 1) / 2) || c > Math.floor((n - 1) / 2))) continue;

      const v = rng() < density ? 1 : 0;
      setBit(r, c, v);

      if (symmetry === "v" || symmetry === "hv") setBit(r, n - 1 - c, v);
      if (symmetry === "h" || symmetry === "hv") setBit(n - 1 - r, c, v);
      if (symmetry === "hv") setBit(n - 1 - r, n - 1 - c, v);
    }
  }

  // Avoid fully empty rows/cols
  for (let r = 0; r < n; r++) {
    let any = false;
    for (let c = 0; c < n; c++) if (bits[r * n + c]) { any = true; break; }
    if (!any) bits[r * n + ((rng() * n) | 0)] = 1;
  }
  for (let c = 0; c < n; c++) {
    let any = false;
    for (let r = 0; r < n; r++) if (bits[r * n + c]) { any = true; break; }
    if (!any) bits[(((rng() * n) | 0) * n) + c] = 1;
  }

  // light smoothing
  const copy = bits.slice();
  const at = (r, c) => copy[r * n + c];
  for (let r = 1; r < n - 1; r++) {
    for (let c = 1; c < n - 1; c++) {
      const idx = r * n + c;
      const v = at(r, c);
      const neigh =
        at(r - 1, c) + at(r + 1, c) + at(r, c - 1) + at(r, c + 1) +
        at(r - 1, c - 1) + at(r - 1, c + 1) + at(r + 1, c - 1) + at(r + 1, c + 1);

      if (v === 1 && neigh === 0 && rng() < 0.7) bits[idx] = 0;
      if (v === 0 && neigh >= 7 && rng() < 0.4) bits[idx] = 1;
    }
  }

  return bits;
}

function makeGeneratedPuzzleFromPreset(preset) {
  const seed = (Date.now() ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0;
  const rng = mulberry32(seed);
  const bits = generateBits(preset.n, preset.density, preset.sym, rng);
  const bitsB64 = bitsToB64(bits);

  return {
    id: `gen-${preset.difficulty}-${preset.n}-${seed}`,
    name: `Generated: ${preset.label}`,
    difficulty: preset.difficulty,
    size: preset.n,
    seed,
    bitsB64
  };
}

function bitsFromMeta(meta) {
  return b64ToBits(meta.bitsB64, meta.size * meta.size);
}

/* -------------------- Recents -------------------- */
function loadRecents() {
  try {
    const raw = localStorage.getItem(STORAGE_RECENTS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(x =>
      x && typeof x.id === "string" &&
      typeof x.name === "string" &&
      typeof x.difficulty === "string" &&
      Number.isFinite(x.size) &&
      typeof x.bitsB64 === "string"
    );
  } catch {
    return [];
  }
}

function saveRecents(list) {
  try { localStorage.setItem(STORAGE_RECENTS, JSON.stringify(list)); } catch {}
}

function addToRecents(meta) {
  const list = loadRecents().filter(x => x.bitsB64 !== meta.bitsB64);
  list.unshift(meta);
  saveRecents(list.slice(0, 20));
}

function buildSelector(selectedValue = null) {
  const recents = loadRecents();
  els.puzzleSelect.innerHTML = "";

  const og1 = document.createElement("optgroup");
  og1.label = "Generate";
  for (const p of PRESETS) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    og1.appendChild(opt);
  }
  els.puzzleSelect.appendChild(og1);

  const og2 = document.createElement("optgroup");
  og2.label = "Recent";
  if (recents.length === 0) {
    const opt = document.createElement("option");
    opt.value = "recent-none";
    opt.textContent = "— None yet —";
    opt.disabled = true;
    og2.appendChild(opt);
  } else {
    for (const r of recents) {
      const opt = document.createElement("option");
      opt.value = `recent:${r.id}`;
      opt.textContent = `${r.name} • ${r.size}×${r.size}`;
      og2.appendChild(opt);
    }
  }
  els.puzzleSelect.appendChild(og2);

  if (selectedValue) els.puzzleSelect.value = selectedValue;
}

/* -------------------- Clues -------------------- */
function calcCluesForLine(bits) {
  const clues = [];
  let run = 0;
  for (const b of bits) {
    if (b === 1) run++;
    else if (run > 0) { clues.push(run); run = 0; }
  }
  if (run > 0) clues.push(run);
  return clues.length ? clues : [0];
}

function getRowBits(arr, r) {
  const out = [];
  for (let c = 0; c < size; c++) out.push(arr[r * size + c]);
  return out;
}
function getColBits(arr, c) {
  const out = [];
  for (let r = 0; r < size; r++) out.push(arr[r * size + c]);
  return out;
}

function currentRowClues() {
  const clues = [];
  for (let r = 0; r < size; r++) clues.push(calcCluesForLine(getRowBits(solution, r)));
  return clues;
}
function currentColClues() {
  const clues = [];
  for (let c = 0; c < size; c++) clues.push(calcCluesForLine(getColBits(solution, c)));
  return clues;
}

function playerRowClues(r) {
  const bits = getRowBits(state.map(v => (v === 1 ? 1 : 0)), r);
  return calcCluesForLine(bits);
}
function playerColClues(c) {
  const bits = getColBits(state.map(v => (v === 1 ? 1 : 0)), c);
  return calcCluesForLine(bits);
}

function cluesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* -------------------- Layout sizing -------------------- */
function computeRowClueWidth(cellPx) {
  const rowClues = currentRowClues();
  const maxRowClueCount = Math.max(...rowClues.map(c => c.length));

  const clueFont = clamp(Math.floor(cellPx * 0.42), 10, 12);
  const perNum = Math.floor(clueFont * 1.6);
  const gap = 4;
  const padding = 12;

  const w = (maxRowClueCount * perNum) + Math.max(0, (maxRowClueCount - 1) * gap) + padding;
  return clamp(w, 48, 92);
}

function computeCellSize() {
  const gameEl = els.grid.closest(".ngGame");
  const gameRect = gameEl.getBoundingClientRect();

  const assumedCell = 28;
  const rowGutterW = computeRowClueWidth(assumedCell);

  const gap = 10; // must match CSS gap in .ngGame
  const paddingSafety = 6;

  const availableGridW = Math.max(
    180,
    Math.floor(gameRect.width - rowGutterW - gap - paddingSafety)
  );
  const availableGridH = Math.floor(window.innerHeight * 0.60);

  const maxGridPx = Math.max(160, Math.min(availableGridW, availableGridH));
  const rawCell = Math.floor(maxGridPx / size);

  return clamp(rawCell, 18, 44);
}

function buildLayout() {
  const cell = computeCellSize();

  document.documentElement.style.setProperty("--ngSize", String(size));
  document.documentElement.style.setProperty("--ngCell", `${cell}px`);

  const colClues = currentColClues();
  const maxColClueCount = Math.max(...colClues.map(c => c.length));
  const cornerH = Math.max(40, maxColClueCount * 16);

  const rowClueW = computeRowClueWidth(cell);
  document.documentElement.style.setProperty("--rowClueW", `${rowClueW}px`);

  els.corner.style.width = `${rowClueW}px`;
  els.corner.style.height = `${cornerH}px`;
  els.colClues.style.height = `${cornerH}px`;

  const markFont = clamp(Math.floor(cell * 0.60), 12, 22);
  els.grid.style.setProperty("font-size", `${markFont}px`);
}

/* -------------------- Rendering -------------------- */
function renderClues() {
  const rowClues = currentRowClues();
  const colClues = currentColClues();

  els.rowClues.innerHTML = "";
  for (let r = 0; r < size; r++) {
    const cell = document.createElement("div");
    cell.className = "clueCell row";

    const nums = document.createElement("div");
    nums.className = "clueNums";

    for (const n of rowClues[r]) {
      const span = document.createElement("span");
      span.textContent = String(n);
      nums.appendChild(span);
    }

    cell.appendChild(nums);
    els.rowClues.appendChild(cell);
  }

  els.colClues.innerHTML = "";
  for (let c = 0; c < size; c++) {
    const cell = document.createElement("div");
    cell.className = "clueCell col";

    const nums = document.createElement("div");
    nums.className = "clueNums";

    for (const n of colClues[c]) {
      const span = document.createElement("span");
      span.textContent = String(n);
      nums.appendChild(span);
    }

    cell.appendChild(nums);
    els.colClues.appendChild(cell);
  }
}

function renderGrid() {
  els.grid.innerHTML = "";
  const block = (size >= 10) ? 5 : 0;

  for (let i = 0; i < size * size; i++) {
    const r = Math.floor(i / size);
    const c = i % size;

    const cell = document.createElement("div");
    cell.className = "ngCell";
    cell.dataset.i = String(i);

    if (state[i] === 1) cell.classList.add("filled");
    if (state[i] === 2) { cell.classList.add("marked"); cell.textContent = "✕"; }

    if (block && (r + 1) % block === 0 && r !== size - 1) cell.classList.add("blockR");
    if (block && (c + 1) % block === 0 && c !== size - 1) cell.classList.add("blockC");

    els.grid.appendChild(cell);
  }
}

function renderClueCompletion() {
  const rowClueEls = els.rowClues.querySelectorAll(".clueCell.row");
  const colClueEls = els.colClues.querySelectorAll(".clueCell.col");

  const solRow = currentRowClues();
  const solCol = currentColClues();

  for (let r = 0; r < size; r++) {
    const done = cluesEqual(playerRowClues(r), solRow[r]);
    rowClueEls[r]?.classList.toggle("done", done);
  }
  for (let c = 0; c < size; c++) {
    const done = cluesEqual(playerColClues(c), solCol[c]);
    colClueEls[c]?.classList.toggle("done", done);
  }
}

function updateUndoRedoButtons() {
  els.btnUndo.disabled = undoStack.length === 0;
  els.btnRedo.disabled = redoStack.length === 0;
}

function renderAll() {
  buildLayout();
  renderClues();
  renderGrid();
  renderClueCompletion();
  updateUndoRedoButtons();
}

/* -------------------- Progress persistence -------------------- */
function saveProgress() {
  if (!currentMeta?.id) return;
  try {
    localStorage.setItem(puzzleKey(currentMeta.id), JSON.stringify({
      v: 3,
      state,
      undoStack,
      redoStack,
      tool
    }));
  } catch {}
}

function loadProgressForCurrent() {
  if (!currentMeta?.id) return false;
  try {
    const raw = localStorage.getItem(puzzleKey(currentMeta.id));
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || data.v !== 3) return false;
    if (!Array.isArray(data.state) || data.state.length !== size * size) return false;

    state = data.state.slice();
    undoStack = Array.isArray(data.undoStack) ? data.undoStack : [];
    redoStack = Array.isArray(data.redoStack) ? data.redoStack : [];
    tool = (data.tool === "mark") ? "mark" : "fill";
    applyToolUi();
    return true;
  } catch {
    return false;
  }
}

function resetProgress() {
  state = new Array(size * size).fill(0);
  undoStack = [];
  redoStack = [];
  updateUndoRedoButtons();
  saveProgress();
  renderAll();
}

/* -------------------- Tool UI -------------------- */
function applyToolUi() {
  const fillOn = tool === "fill";
  els.toolFill.classList.toggle("active", fillOn);
  els.toolMark.classList.toggle("active", !fillOn);
  els.toolFill.setAttribute("aria-pressed", String(fillOn));
  els.toolMark.setAttribute("aria-pressed", String(!fillOn));
}
function setTool(next) {
  tool = next;
  applyToolUi();
  saveProgress();
}

/* -------------------- Gameplay -------------------- */
function cellIndexFromPoint(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const cell = el ? el.closest(".ngCell") : null;
  if (!cell) return null;
  const i = Number(cell.dataset.i);
  return Number.isFinite(i) ? i : null;
}

function applyCell(i, toVal) {
  const from = state[i];
  if (from === toVal) return false;
  state[i] = toVal;

  if (!strokeChanges) strokeChanges = new Map();
  if (!strokeChanges.has(i)) strokeChanges.set(i, { from, to: toVal });
  else strokeChanges.get(i).to = toVal;

  return true;
}

function updateCellVisual(i) {
  const el = els.grid.children[i];
  if (!el) return;
  el.classList.toggle("filled", state[i] === 1);
  el.classList.toggle("marked", state[i] === 2);
  el.textContent = (state[i] === 2) ? "✕" : "";
  el.classList.remove("bad");
}

function beginStroke(targetIndex, forcedTool = null) {
  isPointerDown = true;
  strokeChanges = new Map();

  const usingTool = forcedTool || tool;
  const cur = state[targetIndex];

  if (usingTool === "fill") paintTo = (cur === 1) ? 0 : 1;
  else paintTo = (cur === 2) ? 0 : 2;

  applyCell(targetIndex, paintTo);
  updateCellVisual(targetIndex);
  renderClueCompletion();
}

function commitStroke() {
  if (!isPointerDown) return;
  isPointerDown = false;

  if (!strokeChanges || strokeChanges.size === 0) {
    strokeChanges = null;
    return;
  }

  const step = [];
  for (const [i, change] of strokeChanges.entries()) step.push({ i, from: change.from, to: change.to });

  undoStack.push(step);
  if (undoStack.length > 300) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();

  saveProgress();
  strokeChanges = null;

  if (isSolved()) setStatus("Solved! 🎉");
}

function isSolved() {
  for (let i = 0; i < size * size; i++) {
    const filled = state[i] === 1;
    const shouldFill = solution[i] === 1;
    if (filled !== shouldFill) return false;
  }
  return true;
}

function checkAgainstSolution() {
  const cells = els.grid.querySelectorAll(".ngCell");
  cells.forEach(c => c.classList.remove("bad"));

  let wrong = 0;
  for (let i = 0; i < size * size; i++) {
    const filled = state[i] === 1;
    const shouldFill = solution[i] === 1;
    if (filled !== shouldFill) wrong++;
    if (filled && !shouldFill) cells[i]?.classList.add("bad");
  }

  if (wrong === 0) setStatus("All correct — solved! 🎉");
  else setStatus(`${wrong} cell(s) differ from the solution.`);
}

function undo() {
  const step = undoStack.pop();
  if (!step) return;

  for (const { i, from } of step) state[i] = from;
  redoStack.push(step);

  updateUndoRedoButtons();
  renderGrid();
  renderClueCompletion();

  saveProgress();
  setStatus("Undo.");
}

function redo() {
  const step = redoStack.pop();
  if (!step) return;

  for (const { i, to } of step) state[i] = to;
  undoStack.push(step);

  updateUndoRedoButtons();
  renderGrid();
  renderClueCompletion();

  saveProgress();
  setStatus("Redo.");
}

/* -------------------- Start / load puzzle -------------------- */
function startFromMeta(meta, { forceNew = false } = {}) {
  currentMeta = meta;

  size = meta.size;
  solution = bitsFromMeta(meta);

  state = new Array(size * size).fill(0);
  undoStack = [];
  redoStack = [];
  applyToolUi();

  const restored = (!forceNew) ? loadProgressForCurrent() : false;

  els.subtitle.textContent = `${meta.name} • ${size}×${size} • Drag to paint`;
  renderAll();
  setStatus(restored ? "Loaded saved progress." : "New puzzle started.");

  addToRecents(meta);
  buildSelector(`recent:${meta.id}`);
}

function generateFromSelectedPreset() {
  const v = els.puzzleSelect.value || PRESETS[1].id;
  const preset = PRESETS.find(p => p.id === v) || PRESETS[1];
  const meta = makeGeneratedPuzzleFromPreset(preset);
  startFromMeta(meta, { forceNew: true });
}

function tryLoadRecentById(id) {
  const recents = loadRecents();
  return recents.find(r => r.id === id) || null;
}

/* -------------------- Input bindings -------------------- */
function bindInput() {
  els.grid.addEventListener("contextmenu", (e) => e.preventDefault());

  els.grid.addEventListener("pointerdown", (e) => {
    const i = cellIndexFromPoint(e.clientX, e.clientY);
    if (i == null) return;

    els.grid.setPointerCapture(e.pointerId);

    const forced = (e.button === 2) ? "mark" : null;
    beginStroke(i, forced);
    e.preventDefault();
  });

  els.grid.addEventListener("pointermove", (e) => {
    if (!isPointerDown) return;

    const i = cellIndexFromPoint(e.clientX, e.clientY);
    if (i == null) return;

    const changed = applyCell(i, paintTo);
    if (changed) {
      updateCellVisual(i);
      renderClueCompletion();
    }
  });

  const end = () => commitStroke();
  els.grid.addEventListener("pointerup", end);
  els.grid.addEventListener("pointercancel", end);
  els.grid.addEventListener("lostpointercapture", end);

  els.toolFill.addEventListener("click", () => setTool("fill"));
  els.toolMark.addEventListener("click", () => setTool("mark"));

  els.btnReset.addEventListener("click", () => {
    resetProgress();
    setStatus("Reset.");
  });

  els.btnCheck.addEventListener("click", () => checkAgainstSolution());
  els.btnUndo.addEventListener("click", undo);
  els.btnRedo.addEventListener("click", redo);

  els.btnNew.addEventListener("click", () => generateFromSelectedPreset());

  els.puzzleSelect.addEventListener("change", () => {
    const v = els.puzzleSelect.value;

    if (v.startsWith("recent:")) {
      const id = v.slice("recent:".length);
      const meta = tryLoadRecentById(id);
      if (meta) startFromMeta(meta, { forceNew: false });
      else setStatus("That recent puzzle is no longer available.");
      return;
    }

    // Preset selected => generate immediately
    generateFromSelectedPreset();
  });

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault(); undo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
      e.preventDefault(); redo();
    } else if (e.key.toLowerCase() === "f") {
      setTool("fill");
    } else if (e.key.toLowerCase() === "x" || e.key.toLowerCase() === "m") {
      setTool("mark");
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveProgress();
  });
}

/* Debounced resize for responsive cell sizing */
let resizeTimer = null;
function onResize() {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderAll(), 80);
}

/* -------------------- Boot -------------------- */
function boot() {
  bindInput();

  // Build selector and start with most recent puzzle (if any)
  buildSelector(PRESETS[1].id);

  const recents = loadRecents();
  if (recents.length > 0) {
    startFromMeta(recents[0], { forceNew: false });
    els.puzzleSelect.value = `recent:${recents[0].id}`;
  } else {
    els.puzzleSelect.value = PRESETS[1].id;
    generateFromSelectedPreset();
  }

  window.addEventListener("resize", onResize);
}

boot();

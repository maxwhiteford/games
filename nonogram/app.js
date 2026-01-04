/* Nonogram
   - Dynamic cell sizing via CSS variables (responsive + square)
   - Clues rendering (rows + cols)
   - Fill/Mark tools + right-click marking (desktop)
   - Drag painting (pointer events) ✅ fixed via elementFromPoint hit-testing
   - Undo/Redo (stroke grouped)
   - Reset/Check + solved detection
   - LocalStorage persistence per puzzle
   - Compact row clue gutter (minimal width + consistent sizing)
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

const PUZZLES = [
  {
    id: "plus-5",
    name: "Starter: Plus (5×5)",
    size: 5,
    rows: [
      ".###.",
      "#.#.#",
      "#####",
      "#.#.#",
      ".###.",
    ],
  },
  {
    id: "heart-10",
    name: "Heart (10×10)",
    size: 10,
    rows: [
      "..##..##..",
      ".####.####",
      "##########",
      "##########",
      ".########.",
      "..######..",
      "...####...",
      "....##....",
      "..........",
      "..........",
    ],
  },
  {
    id: "smile-15",
    name: "Smiley (15×15)",
    size: 15,
    rows: [
      "...............",
      "...####...####.",
      "..######.######",
      "..######.######",
      "...####...####.",
      "...............",
      ".##.........##.",
      ".##.........##.",
      "...............",
      "...#########...",
      "....#######....",
      ".....#####.....",
      "......###......",
      ".......#.......",
      "...............",
    ],
  },
];

// State: 0 empty, 1 filled, 2 marked
let size = 5;
let solution = []; // 0/1 array
let state = [];    // 0/1/2 array

let tool = "fill"; // "fill" | "mark"
let isPointerDown = false;
let strokeChanges = null; // Map index -> {from,to}
let paintTo = null;       // value applied during drag

let undoStack = [];
let redoStack = [];

const STORAGE_PREFIX = "cf-nonogram:v2:";

function setStatus(msg) {
  els.status.textContent = msg;
}

function puzzleKey(puzzleId) {
  return `${STORAGE_PREFIX}${puzzleId}`;
}

function parseSolutionRows(puz) {
  const s = [];
  for (const row of puz.rows) {
    for (const ch of row) s.push(ch === "#" ? 1 : 0);
  }
  return s;
}

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

function updateUndoRedoButtons() {
  els.btnUndo.disabled = undoStack.length === 0;
  els.btnRedo.disabled = redoStack.length === 0;
}

function saveProgress(puzzleId) {
  try {
    localStorage.setItem(puzzleKey(puzzleId), JSON.stringify({
      v: 2,
      state,
      undoStack,
      redoStack,
      tool
    }));
  } catch {}
}

function loadProgress(puzzleId) {
  try {
    const raw = localStorage.getItem(puzzleKey(puzzleId));
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || data.v !== 2) return false;
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

function resetProgress(puzzleId) {
  state = new Array(size * size).fill(0);
  undoStack = [];
  redoStack = [];
  updateUndoRedoButtons();
  saveProgress(puzzleId);
  renderAll();
}

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
  saveProgress(currentPuzzle().id);
}

function currentPuzzle() {
  const id = els.puzzleSelect.value;
  return PUZZLES.find(p => p.id === id) || PUZZLES[0];
}

function buildPuzzleSelect() {
  els.puzzleSelect.innerHTML = "";
  for (const p of PUZZLES) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    els.puzzleSelect.appendChild(opt);
  }
}

/* -------- Dynamic sizing via CSS variables -------- */
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

/* Updated: compute using a compact row clue gutter width variable (--rowClueW) */
function computeRowClueWidth(cellPx) {
  const rowClues = currentRowClues();
  const maxRowClueCount = Math.max(...rowClues.map(c => c.length));

  // Scale clue font with cell size (must roughly match CSS)
  const clueFont = clamp(Math.floor(cellPx * 0.42), 10, 12);

  // Rough per-number width: budget for up to 2 digits plus breathing room
  const perNum = Math.floor(clueFont * 1.6);
  const gap = 4; // matches .clueNums { gap: 4px; }
  const padding = 12; // clue cell padding (6px left+right)

  const w = (maxRowClueCount * perNum) + Math.max(0, (maxRowClueCount - 1) * gap) + padding;

  // Keep it compact on tiny screens; don't let it get silly large either.
  return clamp(w, 48, 92);
}

function computeCellSize() {
  const gameEl = els.grid.closest(".ngGame");
  const gameRect = gameEl.getBoundingClientRect();

  // First pass: assume a mid cell to estimate row clue gutter width
  const assumedCell = 28;
  const rowGutterW = computeRowClueWidth(assumedCell);

  const gap = 10; // must match CSS var --ngGap
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

  // Corner height still based on column clue depth
  const colClues = currentColClues();
  const maxColClueCount = Math.max(...colClues.map(c => c.length));
  const cornerH = Math.max(40, maxColClueCount * 16);

  // NEW: compact row clue gutter width driven by content
  const rowClueW = computeRowClueWidth(cell);
  document.documentElement.style.setProperty("--rowClueW", `${rowClueW}px`);

  // Corner should match the row clue gutter width visually
  els.corner.style.width = `${rowClueW}px`;
  els.corner.style.height = `${cornerH}px`;

  // Do NOT force ngRowClues width anymore (CSS uses width: fit-content)
  // els.rowClues.style.width = ...
  els.colClues.style.height = `${cornerH}px`;

  const markFont = clamp(Math.floor(cell * 0.60), 12, 22);
  els.grid.style.setProperty("font-size", `${markFont}px`);
}

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

function renderAll() {
  buildLayout();
  renderClues();
  renderGrid();
  renderClueCompletion();
  updateUndoRedoButtons();
}

/* -------- Drag painting helpers (FIX) -------- */
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
  for (const [i, change] of strokeChanges.entries()) {
    step.push({ i, from: change.from, to: change.to });
  }

  undoStack.push(step);
  if (undoStack.length > 300) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();

  saveProgress(currentPuzzle().id);

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

  saveProgress(currentPuzzle().id);
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

  saveProgress(currentPuzzle().id);
  setStatus("Redo.");
}

function startPuzzle(puzId, { forceNew = false } = {}) {
  const puz = PUZZLES.find(p => p.id === puzId) || PUZZLES[0];
  els.puzzleSelect.value = puz.id;

  size = puz.size;
  solution = parseSolutionRows(puz);

  state = new Array(size * size).fill(0);
  undoStack = [];
  redoStack = [];
  applyToolUi();

  if (!forceNew) loadProgress(puz.id);
  else saveProgress(puz.id);

  els.subtitle.textContent = `Puzzle: ${puz.name} • ${size}×${size} • Drag to paint`;

  renderAll();
  setStatus(forceNew ? "New puzzle started." : "Loaded puzzle.");
}

function bindInput() {
  els.grid.addEventListener("contextmenu", (e) => e.preventDefault());

  els.grid.addEventListener("pointerdown", (e) => {
    const i = cellIndexFromPoint(e.clientX, e.clientY);
    if (i == null) return;

    // Capture pointer so we keep receiving moves even if finger leaves grid
    els.grid.setPointerCapture(e.pointerId);

    const forced = (e.button === 2) ? "mark" : null;
    beginStroke(i, forced);
    e.preventDefault();
  });

  els.grid.addEventListener("pointermove", (e) => {
    if (!isPointerDown) return;

    // IMPORTANT: hit-test using elementFromPoint (works with pointer capture)
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
    resetProgress(currentPuzzle().id);
    setStatus("Reset.");
  });
  els.btnCheck.addEventListener("click", () => checkAgainstSolution());
  els.btnUndo.addEventListener("click", undo);
  els.btnRedo.addEventListener("click", redo);

  els.btnNew.addEventListener("click", () => {
    startPuzzle(els.puzzleSelect.value, { forceNew: true });
  });

  els.puzzleSelect.addEventListener("change", () => {
    startPuzzle(els.puzzleSelect.value, { forceNew: false });
  });

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
      e.preventDefault();
      redo();
    } else if (e.key.toLowerCase() === "f") {
      setTool("fill");
    } else if (e.key.toLowerCase() === "x" || e.key.toLowerCase() === "m") {
      setTool("mark");
    }
  });
}

/* Debounced resize for responsive cell sizing */
let resizeTimer = null;
function onResize() {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderAll();
  }, 80);
}

function boot() {
  buildPuzzleSelect();
  bindInput();

  startPuzzle(PUZZLES[0].id, { forceNew: false });

  window.addEventListener("resize", onResize);
}

boot();

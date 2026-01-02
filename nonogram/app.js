/* Fully functional Nonogram
   - Clues rendering (rows + cols)
   - Fill/Mark tools + right-click marking (desktop)
   - Drag painting (pointer events)
   - Undo/Redo (stroke grouped)
   - Reset/Check + solved detection
   - LocalStorage persistence per puzzle
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

// Puzzles: store solution as array of strings rows ("#"/".") for readability.
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
  // Only filled cells count for clues; marks are treated as empty
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
  const p = currentPuzzle();
  saveProgress(p.id);
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

function buildLayout() {
  // Decide cell size: responsive
  // We'll set CSS variables by inline style for grid template.
  els.grid.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  els.grid.style.gridTemplateRows = `repeat(${size}, 1fr)`;

  // Set a reasonable square size via max width: grid will fill available.
  // Corner size based on max row clues width and max col clues height.
}

function renderClues() {
  const rowClues = currentRowClues();
  const colClues = currentColClues();

  // Determine gutters
  const maxRowClueCount = Math.max(...rowClues.map(c => c.length));
  const maxColClueCount = Math.max(...colClues.map(c => c.length));

  // Corner sizing: give enough area for column clues height and row clue width
  // Each clue "line" roughly 14px. We'll use CSS by inline styles.
  const cornerW = Math.max(80, maxRowClueCount * 18);
  const cornerH = Math.max(40, maxColClueCount * 16);

  els.corner.style.width = `${cornerW}px`;
  els.corner.style.height = `${cornerH}px`;

  els.rowClues.style.gridTemplateRows = `repeat(${size}, auto)`;
  els.rowClues.style.width = `${cornerW}px`;

  els.colClues.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  els.colClues.style.height = `${cornerH}px`;

  // Render row clues
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

  // Render col clues
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

  // Block separators: for larger puzzles, draw thicker lines every 5
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

function applyCell(i, toVal) {
  const from = state[i];
  if (from === toVal) return false;
  state[i] = toVal;

  if (!strokeChanges) strokeChanges = new Map();
  // First change in this stroke determines original "from"
  if (!strokeChanges.has(i)) strokeChanges.set(i, { from, to: toVal });
  else strokeChanges.get(i).to = toVal;

  return true;
}

function beginStroke(targetIndex, forcedTool = null) {
  isPointerDown = true;
  strokeChanges = new Map();

  // Determine "paintTo" based on current tool and target state
  const usingTool = forcedTool || tool;
  const cur = state[targetIndex];

  if (usingTool === "fill") {
    // toggle fill: empty/marked -> filled, filled -> empty
    paintTo = (cur === 1) ? 0 : 1;
  } else {
    // toggle mark: empty/filled -> marked, marked -> empty
    paintTo = (cur === 2) ? 0 : 2;
  }

  applyCell(targetIndex, paintTo);
  renderGrid();
  renderClueCompletion();
}

function commitStroke() {
  if (!isPointerDown) return;
  isPointerDown = false;

  if (!strokeChanges || strokeChanges.size === 0) {
    strokeChanges = null;
    return;
  }

  // Record undo as an array of {i,from,to}
  const step = [];
  for (const [i, change] of strokeChanges.entries()) {
    step.push({ i, from: change.from, to: change.to });
  }

  undoStack.push(step);
  if (undoStack.length > 300) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();

  const p = currentPuzzle();
  saveProgress(p.id);

  strokeChanges = null;

  // If solved, announce
  if (isSolved()) {
    setStatus("Solved! 🎉");
  }
}

function isSolved() {
  // Must match filled cells exactly to solution.
  // Marks don't matter (treated as empty).
  for (let i = 0; i < size * size; i++) {
    const filled = state[i] === 1;
    const shouldFill = solution[i] === 1;
    if (filled !== shouldFill) return false;
  }
  return true;
}

function checkAgainstSolution() {
  // Mark incorrect filled cells as bad (simple feedback).
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

  // Fresh state
  state = new Array(size * size).fill(0);
  undoStack = [];
  redoStack = [];
  applyToolUi();

  // Try load saved progress unless forceNew
  if (!forceNew) {
    loadProgress(puz.id);
  } else {
    // clearing old progress is optional; we reset state anyway
    saveProgress(puz.id);
  }

  // Adjust subtitle
  els.subtitle.textContent =
    `Puzzle: ${puz.name} • ${size}×${size} • Drag to paint`;

  renderAll();

  setStatus(forceNew ? "New puzzle started." : "Loaded puzzle.");
}

function bindInput() {
  // Disable context menu on grid so right-click works for marking
  els.grid.addEventListener("contextmenu", (e) => e.preventDefault());

  // Pointer painting
  els.grid.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest(".ngCell");
    if (!cell) return;

    els.grid.setPointerCapture(e.pointerId);

    const i = Number(cell.dataset.i);

    // On desktop, right click => force mark tool for this stroke
    const forced = (e.button === 2) ? "mark" : null;

    beginStroke(i, forced);
    e.preventDefault();
  });

  els.grid.addEventListener("pointermove", (e) => {
    if (!isPointerDown) return;
    const cell = e.target.closest(".ngCell");
    if (!cell) return;

    const i = Number(cell.dataset.i);
    const changed = applyCell(i, paintTo);
    if (changed) {
      // Update visuals without rebuilding everything
      const el = els.grid.children[i];
      el.classList.toggle("filled", state[i] === 1);
      el.classList.toggle("marked", state[i] === 2);
      el.textContent = (state[i] === 2) ? "✕" : "";
      el.classList.remove("bad");
      renderClueCompletion();
    }
  });

  const end = () => commitStroke();
  els.grid.addEventListener("pointerup", end);
  els.grid.addEventListener("pointercancel", end);

  // Tool buttons
  els.toolFill.addEventListener("click", () => setTool("fill"));
  els.toolMark.addEventListener("click", () => setTool("mark"));

  // Controls
  els.btnReset.addEventListener("click", () => {
    resetProgress(currentPuzzle().id);
    setStatus("Reset.");
  });
  els.btnCheck.addEventListener("click", () => checkAgainstSolution());
  els.btnUndo.addEventListener("click", undo);
  els.btnRedo.addEventListener("click", redo);

  els.btnNew.addEventListener("click", () => {
    // start the currently selected puzzle as a fresh run
    startPuzzle(els.puzzleSelect.value, { forceNew: true });
  });

  els.puzzleSelect.addEventListener("change", () => {
    startPuzzle(els.puzzleSelect.value, { forceNew: false });
  });

  // Keyboard shortcuts (desktop)
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

function boot() {
  buildPuzzleSelect();
  bindInput();

  // Start with first puzzle
  startPuzzle(PUZZLES[0].id, { forceNew: false });
}

boot();

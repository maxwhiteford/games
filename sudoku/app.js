/* Sudoku (static) — generator + solver + UI state (notes/undo/share)
   + progress persistence (LocalStorage)
   + Continue Last Game button
   + Mobile-friendly layout + Pause overlay Resume button
   + Completed overlay (separate from pause)
*/

const $ = (id) => document.getElementById(id);

const boardEl = $("board");
const statusEl = $("status");
const timerEl = $("timer");

const gameWrapEl = $("gameWrap");

const appMenuEl = $("appMenu");
const newMenuEl = $("newMenu");
const newDifficultyLabelEl = $("newDifficultyLabel");

const btnContinue = $("continue");
const btnReset = $("reset");
const btnSolve = $("solve");

const btnCheck = $("check");
const btnNotes = $("notes");
const btnUndo = $("undo");
const btnRedo = $("redo");
const btnErase = $("erase");
const btnPause = $("pause");

const pauseOverlayEl = $("pauseOverlay");
const btnResume = $("resume");

// Completed overlay
const completeOverlayEl = $("completeOverlay");
const btnCompleteNew = $("completeNew");
const btnCompleteClose = $("completeClose");

let notesMode = false;
let paused = false;
let completed = false;
let currentDifficulty = "medium";

// State
let givens = new Array(81).fill(false);
let values = new Array(81).fill(0);
let notes = Array.from({ length: 81 }, () => new Set());
let solution = new Array(81).fill(0);
let selected = -1;

// History for undo/redo
let undoStack = [];
let redoStack = [];

// Timer interval
let timerHandle = null;

// -------- Persistence (LocalStorage) --------
const STORAGE_PREFIX = "cf-sudoku:v3:";
const STORAGE_LAST = "cf-sudoku:v3:last";

// elapsed time tracking (persistable)
let elapsedMs = 0;
let lastTickAt = 0;

function isLocked() {
  return paused || completed;
}

function setStatus(msg, kind = "info") {
  statusEl.textContent = msg;
  statusEl.dataset.kind = kind;
}

function nowMs() { return Date.now(); }

function startElapsedClock(reset = false) {
  if (reset) elapsedMs = 0;
  lastTickAt = nowMs();
}

function tickElapsed() {
  const t = nowMs();
  elapsedMs += Math.max(0, t - lastTickAt);
  lastTickAt = t;
}

function formatTime(ms) {
  const secs = Math.floor(ms / 1000);
  const m = String(Math.floor(secs / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function currentPuzzleStrFromUrl() {
  const u = new URL(window.location.href);
  const p = u.searchParams.get("p");
  if (!p || p.length !== 81) return null;
  return p;
}
function currentPuzzleKey() {
  const p = currentPuzzleStrFromUrl();
  if (!p) return null;
  return STORAGE_PREFIX + p;
}

// Convert notes Set -> bitmask (1..9 => bits 0..8)
function notesToMask(set) {
  let m = 0;
  for (const n of set) m |= (1 << (n - 1));
  return m >>> 0;
}
function maskToNotes(mask) {
  const s = new Set();
  for (let n = 1; n <= 9; n++) if (mask & (1 << (n - 1))) s.add(n);
  return s;
}

function setLastPuzzleStr(puzStr) {
  try { localStorage.setItem(STORAGE_LAST, puzStr); } catch {}
}
function getLastPuzzleStr() {
  try { return localStorage.getItem(STORAGE_LAST); } catch { return null; }
}
function hasSavedPuzzle(puzStr) {
  if (!puzStr || puzStr.length !== 81) return false;
  try { return localStorage.getItem(STORAGE_PREFIX + puzStr) != null; } catch { return false; }
}
function updateContinueButton() {
  const last = getLastPuzzleStr();
  btnContinue.disabled = !(last && last.length === 81 && hasSavedPuzzle(last));
}

// Debounced save to avoid excessive writes
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProgress, 250);
}

function saveProgress() {
  const key = currentPuzzleKey();
  const puzzleStr = currentPuzzleStrFromUrl();
  if (!key || !puzzleStr) return;

  if (!paused && !completed) tickElapsed();

  const payload = {
    v: 3,
    savedAt: nowMs(),
    difficulty: currentDifficulty,
    notesMode,
    paused,
    completed,
    elapsedMs,

    givens,
    values,
    solution,
    notesMasks: notes.map(notesToMask),

    selected,
    undoStack,
    redoStack,
  };

  try {
    localStorage.setItem(key, JSON.stringify(payload));
    setLastPuzzleStr(puzzleStr);
  } catch {
    // ignore quota/private errors
  }
  updateContinueButton();
}

function clearProgressForCurrentPuzzle() {
  const key = currentPuzzleKey();
  if (!key) return;
  try { localStorage.removeItem(key); } catch {}
  updateContinueButton();
}

function loadProgressIfAny(puzStr) {
  const key = STORAGE_PREFIX + puzStr;
  let raw = null;
  try { raw = localStorage.getItem(key); } catch { raw = null; }
  if (!raw) return false;

  let data;
  try { data = JSON.parse(raw); } catch { return false; }
  if (!data || data.v !== 3) return false;

  if (!Array.isArray(data.values) || data.values.length !== 81) return false;
  if (!Array.isArray(data.solution) || data.solution.length !== 81) return false;

  currentDifficulty = data.difficulty || "medium";
  setNewDifficultyLabel(currentDifficulty);

  notesMode = !!data.notesMode;
  btnNotes.textContent = `Notes: ${notesMode ? "On" : "Off"}`;

  // Restore board state first
  givens = Array.isArray(data.givens) && data.givens.length === 81 ? data.givens.slice() : givens;
  values = data.values.slice();
  solution = data.solution.slice();
  notes = Array.from({ length: 81 }, (_, i) => maskToNotes((data.notesMasks && data.notesMasks[i]) || 0));

  undoStack = Array.isArray(data.undoStack) ? data.undoStack : [];
  redoStack = Array.isArray(data.redoStack) ? data.redoStack : [];
  selected = (typeof data.selected === "number" ? data.selected : -1);

  elapsedMs = typeof data.elapsedMs === "number" ? data.elapsedMs : 0;
  startElapsedClock(false);
  timerEl.textContent = formatTime(elapsedMs);

  // Restore completed/paused states (completed overrides pause)
  completed = !!data.completed;
  paused = !!data.paused && !completed;

  applyCompletedUi(completed, { silent: true });
  applyPausedUi(paused, { silent: true });

  render();
  updateContinueButton();

  if (!paused && !completed) startTimer(false);
  else stopTimerOnly();

  setStatus("Restored saved progress.", "info");
  return true;
}

function continueLastGame() {
  const puzStr = getLastPuzzleStr();
  if (!puzStr || puzStr.length !== 81) {
    setStatus("No saved game found.", "warn");
    updateContinueButton();
    return;
  }

  let raw = null;
  try { raw = localStorage.getItem(STORAGE_PREFIX + puzStr); } catch { raw = null; }
  if (!raw) {
    setStatus("No saved game found.", "warn");
    updateContinueButton();
    return;
  }

  let data;
  try { data = JSON.parse(raw); } catch { data = null; }
  if (!data || !Array.isArray(data.solution) || data.solution.length !== 81) {
    setStatus("Saved game looks corrupted.", "warn");
    updateContinueButton();
    return;
  }

  const u = new URL(window.location.href);
  u.searchParams.set("p", puzStr);
  u.searchParams.set("s", encodeGrid(data.solution));
  window.history.replaceState({}, "", u.toString());

  loadProgressIfAny(puzStr);
  setStatus("Continued last game.", "info");
}

// -------- Timer --------
function startTimer(reset = false) {
  if (reset) elapsedMs = 0;
  startElapsedClock(reset);

  if (timerHandle) clearInterval(timerHandle);
  timerHandle = setInterval(() => {
    if (paused || completed) return;
    tickElapsed();
    timerEl.textContent = formatTime(elapsedMs);
  }, 250);
}

function stopTimerOnly() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

function stopTimerAndSave() {
  stopTimerOnly();
  saveProgress();
}

// -------- Sudoku helpers --------
function idxToRC(i) { return { r: Math.floor(i / 9), c: i % 9 }; }
function rcToIdx(r, c) { return r * 9 + c; }

function peersOf(i) {
  const { r, c } = idxToRC(i);
  const ps = new Set();
  for (let k = 0; k < 9; k++) {
    ps.add(rcToIdx(r, k));
    ps.add(rcToIdx(k, c));
  }
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let rr = br; rr < br + 3; rr++) for (let cc = bc; cc < bc + 3; cc++) ps.add(rcToIdx(rr, cc));
  ps.delete(i);
  return [...ps];
}

function isValidMove(grid, i, v) {
  if (v === 0) return true;
  const { r, c } = idxToRC(i);

  for (let k = 0; k < 9; k++) {
    if (grid[rcToIdx(r, k)] === v && rcToIdx(r, k) !== i) return false;
    if (grid[rcToIdx(k, c)] === v && rcToIdx(k, c) !== i) return false;
  }
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let rr = br; rr < br + 3; rr++) {
    for (let cc = bc; cc < bc + 3; cc++) {
      const j = rcToIdx(rr, cc);
      if (grid[j] === v && j !== i) return false;
    }
  }
  return true;
}

function candidates(grid, i) {
  if (grid[i] !== 0) return [];
  const used = new Set();
  for (const p of peersOf(i)) if (grid[p] !== 0) used.add(grid[p]);
  const cand = [];
  for (let v = 1; v <= 9; v++) if (!used.has(v)) cand.push(v);
  return cand;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Solver with MRV
function solve(grid) {
  const g = grid.slice();

  function pickCell() {
    let best = -1, bestCands = null;
    for (let i = 0; i < 81; i++) {
      if (g[i] === 0) {
        const c = candidates(g, i);
        if (c.length === 0) return { i, cands: [] };
        if (!bestCands || c.length < bestCands.length) {
          best = i;
          bestCands = c;
          if (c.length === 1) break;
        }
      }
    }
    return { i: best, cands: bestCands || [] };
  }

  function bt() {
    const { i, cands } = pickCell();
    if (i === -1) return true;
    if (!cands || cands.length === 0) return false;

    shuffleInPlace(cands);
    for (const v of cands) {
      if (isValidMove(g, i, v)) {
        g[i] = v;
        if (bt()) return true;
        g[i] = 0;
      }
    }
    return false;
  }

  if (!bt()) return null;
  return g;
}

function countSolutions(grid, limit = 2) {
  const g = grid.slice();
  let count = 0;

  function pickCell() {
    let best = -1, bestCands = null;
    for (let i = 0; i < 81; i++) {
      if (g[i] === 0) {
        const c = candidates(g, i);
        if (c.length === 0) return { i, cands: [] };
        if (!bestCands || c.length < bestCands.length) {
          best = i;
          bestCands = c;
          if (c.length === 1) break;
        }
      }
    }
    return { i: best, cands: bestCands || [] };
  }

  function bt() {
    if (count >= limit) return;
    const { i, cands } = pickCell();
    if (i === -1) { count++; return; }
    if (!cands || cands.length === 0) return;

    for (const v of cands) {
      if (isValidMove(g, i, v)) {
        g[i] = v;
        bt();
        g[i] = 0;
        if (count >= limit) return;
      }
    }
  }

  bt();
  return count;
}

function generateFullSolution() {
  const empty = new Array(81).fill(0);
  for (let n = 0; n < 11; n++) {
    const i = (Math.random() * 81) | 0;
    if (empty[i] !== 0) continue;
    const c = candidates(empty, i);
    if (c.length === 0) continue;
    empty[i] = c[(Math.random() * c.length) | 0];
    if (!solve(empty)) empty[i] = 0;
  }
  return solve(empty) || solve(new Array(81).fill(0));
}

const DIFF_CLUES = {
  easy:   { min: 38, max: 45 },
  medium: { min: 32, max: 37 },
  hard:   { min: 26, max: 31 },
  expert: { min: 22, max: 25 },
};

function randInt(a, b) { return a + ((Math.random() * (b - a + 1)) | 0); }

function makePuzzleFromSolution(sol, diffKey) {
  const { min, max } = DIFF_CLUES[diffKey] || DIFF_CLUES.medium;
  const targetClues = randInt(min, max);

  const puzzle = sol.slice();
  const indices = [...Array(81).keys()];
  shuffleInPlace(indices);

  for (const i of indices) {
    const saved = puzzle[i];
    puzzle[i] = 0;

    const n = countSolutions(puzzle, 2);
    if (n !== 1) puzzle[i] = saved;

    const clues = puzzle.filter(x => x !== 0).length;
    if (clues <= targetClues) break;
  }

  while (puzzle.filter(x => x !== 0).length < targetClues) {
    const i = (Math.random() * 81) | 0;
    if (puzzle[i] === 0) puzzle[i] = sol[i];
  }
  return puzzle;
}

// URL sharing: ?p=<81 chars 0-9>&s=<81 chars>
function encodeGrid(g) { return g.map(v => String(v)).join(""); }
function decodeGrid(str) {
  if (!str || str.length !== 81) return null;
  const g = [];
  for (const ch of str) {
    const n = ch.charCodeAt(0) - 48;
    if (n < 0 || n > 9) return null;
    g.push(n);
  }
  return g;
}

// -------- Undo/Redo --------
function pushHistory(action) {
  undoStack.push(action);
  if (undoStack.length > 500) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();
}
function applyAction(action, reverse = false) {
  const { i, prevVal, nextVal, prevNotes, nextNotes } = action;
  if (reverse) {
    values[i] = prevVal;
    notes[i] = new Set(prevNotes);
  } else {
    values[i] = nextVal;
    notes[i] = new Set(nextNotes);
  }
}
function updateUndoRedoButtons() {
  btnUndo.disabled = undoStack.length === 0;
  btnRedo.disabled = redoStack.length === 0;
}

// -------- Pause UI (overlay outside blurred content) --------
function applyPausedUi(isPaused, { silent = false } = {}) {
  // completed overrides pause
  if (completed && isPaused) return;

  paused = isPaused;
  document.body.classList.toggle("isPaused", paused);
  pauseOverlayEl.setAttribute("aria-hidden", paused ? "false" : "true");

  // Pause button only pauses; disabled when paused or completed
  btnPause.disabled = paused || completed;

  if (paused) {
    stopTimerAndSave();
    if (!silent) setStatus("Paused.", "info");
    setTimeout(() => btnResume?.focus?.(), 0);
  } else {
    if (!completed) startTimer(false);
    if (!silent) setStatus("Resumed.", "info");
    scheduleSave();
  }
}

// -------- Completed UI (separate from pause) --------
function applyCompletedUi(isCompleted, { silent = false } = {}) {
  completed = isCompleted;

  // If completed, we should not be paused
  if (completed) {
    paused = false;
    document.body.classList.remove("isPaused");
    pauseOverlayEl.setAttribute("aria-hidden", "true");
  }

  document.body.classList.toggle("isCompleted", completed);
  completeOverlayEl.setAttribute("aria-hidden", completed ? "false" : "true");

  // Pause disabled while completed
  btnPause.disabled = paused || completed;

  if (completed) {
    stopTimerAndSave();
    if (!silent) setStatus("Solved! 🎉", "good");
    setTimeout(() => btnCompleteNew?.focus?.(), 0);
  } else {
    if (!silent) setStatus("Ready.", "info");
    scheduleSave();
  }
}

function setNewDifficultyLabel(diff) {
  const map = { easy: "Easy", medium: "Medium", hard: "Hard", expert: "Expert" };
  newDifficultyLabelEl.textContent = map[diff] || "Medium";
}

function closeDetails(detailsEl) {
  if (detailsEl && detailsEl.open) detailsEl.open = false;
}

// -------- UI rendering --------
function buildBoard() {
  boardEl.innerHTML = "";
  for (let i = 0; i < 81; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.setAttribute("role", "gridcell");
    cell.tabIndex = 0;
    cell.dataset.i = String(i);

    const val = document.createElement("div");
    val.className = "val";

    const notesEl = document.createElement("div");
    notesEl.className = "notes";
    for (let n = 1; n <= 9; n++) {
      const s = document.createElement("span");
      s.textContent = String(n);
      notesEl.appendChild(s);
    }

    cell.appendChild(val);
    cell.appendChild(notesEl);

    cell.addEventListener("click", () => selectCell(i));
    cell.addEventListener("keydown", (e) => onCellKeydown(e, i));

    boardEl.appendChild(cell);
  }
}

function render() {
  const cells = boardEl.querySelectorAll(".cell");
  const selVal = selected !== -1 ? values[selected] : 0;
  const selPeers = selected !== -1 ? new Set(peersOf(selected)) : null;

  cells.forEach((cell) => {
    const i = Number(cell.dataset.i);
    cell.classList.toggle("given", givens[i]);
    cell.classList.toggle("selected", i === selected);

    cell.classList.remove("peer", "same", "conflict");
    if (selected !== -1) {
      if (i !== selected && selPeers.has(i)) cell.classList.add("peer");
      if (selVal !== 0 && values[i] === selVal) cell.classList.add("same");
    }

    const vEl = cell.querySelector(".val");
    const nEl = cell.querySelector(".notes");
    vEl.textContent = values[i] === 0 ? "" : String(values[i]);

    const noteSpans = nEl.querySelectorAll("span");
    noteSpans.forEach((s, idx) => {
      const n = idx + 1;
      s.classList.toggle("on", notes[i].has(n) && values[i] === 0);
    });
  });

  updateUndoRedoButtons();
  updateContinueButton();
}

function selectCell(i) {
  if (isLocked()) return;
  if (selected === i) return;
  selected = i;
  render();
}

function setValue(i, v) {
  if (isLocked()) return;
  if (givens[i]) return;

  const prevVal = values[i];
  const prevNotes = [...notes[i]];

  if (notesMode) {
    if (v === 0) notes[i].clear();
    else notes[i].has(v) ? notes[i].delete(v) : notes[i].add(v);

    pushHistory({ i, prevVal, nextVal: values[i], prevNotes, nextNotes: [...notes[i]] });
    render();
    scheduleSave();
    return;
  }

  if (v === prevVal) v = 0;
  values[i] = v;
  if (v !== 0) notes[i].clear();

  pushHistory({ i, prevVal, nextVal: values[i], prevNotes, nextNotes: [...notes[i]] });

  render();
  scheduleSave();

  if (isComplete()) {
    if (values.every((val, idx) => val === solution[idx])) {
      // IMPORTANT: solved should NOT become paused
      applyPausedUi(false, { silent: true });
      applyCompletedUi(true);
    } else {
      setStatus("Filled, but not correct yet.", "warn");
    }
  }
}

function onCellKeydown(e, i) {
  if (isLocked()) return;

  if (e.key >= "1" && e.key <= "9") {
    e.preventDefault();
    setValue(i, Number(e.key));
  } else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") {
    e.preventDefault();
    setValue(i, 0);
  } else if (e.key === "ArrowLeft") { e.preventDefault(); selectCell(Math.max(0, i - 1)); }
  else if (e.key === "ArrowRight") { e.preventDefault(); selectCell(Math.min(80, i + 1)); }
  else if (e.key === "ArrowUp") { e.preventDefault(); selectCell(Math.max(0, i - 9)); }
  else if (e.key === "ArrowDown") { e.preventDefault(); selectCell(Math.min(80, i + 9)); }
  else if (e.key === "n" || e.key === "N") { toggleNotes(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undo();
  } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
    e.preventDefault();
    redo();
  }
}

function checkConflicts() {
  if (isLocked()) return;
  const cells = boardEl.querySelectorAll(".cell");
  cells.forEach((cell) => cell.classList.remove("conflict"));

  let conflicts = 0;
  for (let i = 0; i < 81; i++) {
    if (values[i] === 0) continue;
    if (!isValidMove(values, i, values[i])) {
      conflicts++;
      cells[i].classList.add("conflict");
    }
  }

  if (conflicts === 0) setStatus("No conflicts found.", "good");
  else setStatus(`Found ${conflicts} conflicting cell(s).`, "warn");
}

function resetToGivens() {
  applyCompletedUi(false, { silent: true });

  for (let i = 0; i < 81; i++) {
    values[i] = givens[i] ? values[i] : 0;
    notes[i].clear();
  }
  undoStack = [];
  redoStack = [];
  selected = -1;

  notesMode = false;
  btnNotes.textContent = "Notes: Off";

  applyPausedUi(false);
  setStatus("Reset.", "info");
  startTimer(true);
  render();
  saveProgress();
}

function fillSolution() {
  applyCompletedUi(false, { silent: true });

  for (let i = 0; i < 81; i++) {
    values[i] = solution[i];
    notes[i].clear();
  }
  undoStack = [];
  redoStack = [];
  selected = -1;

  setStatus("Solved (revealed).", "info");
  applyPausedUi(false, { silent: true });
  applyCompletedUi(true, { silent: true }); // show completed overlay (timer stops)
  render();
  saveProgress();
}

function undo() {
  if (isLocked()) return;
  const a = undoStack.pop();
  if (!a) return;
  applyAction(a, true);
  redoStack.push(a);
  setStatus("Undo.", "info");
  render();
  scheduleSave();
}

function redo() {
  if (isLocked()) return;
  const a = redoStack.pop();
  if (!a) return;
  applyAction(a, false);
  undoStack.push(a);
  setStatus("Redo.", "info");
  render();
  scheduleSave();
}

function toggleNotes() {
  if (isLocked()) return;
  notesMode = !notesMode;
  btnNotes.textContent = `Notes: ${notesMode ? "On" : "Off"}`;
  setStatus(notesMode ? "Notes mode enabled." : "Notes mode disabled.");
  scheduleSave();
}

function eraseSelected() {
  if (isLocked()) return;
  if (selected === -1) return;
  setValue(selected, 0);
}

function isComplete() {
  return values.every(v => v !== 0);
}

function setFromPuzzle(puz, sol, diffKey) {
  applyCompletedUi(false, { silent: true });

  currentDifficulty = diffKey || currentDifficulty;
  setNewDifficultyLabel(currentDifficulty);

  solution = sol.slice();
  values = puz.slice();
  givens = puz.map(v => v !== 0);
  notes = Array.from({ length: 81 }, () => new Set());
  undoStack = [];
  redoStack = [];
  selected = -1;

  notesMode = false;
  btnNotes.textContent = "Notes: Off";

  const u = new URL(window.location.href);
  u.searchParams.set("p", encodeGrid(puz));
  u.searchParams.set("s", encodeGrid(sol));
  window.history.replaceState({}, "", u.toString());

  applyPausedUi(false);
  startTimer(true);

  setStatus("New game started.", "info");
  render();

  clearProgressForCurrentPuzzle();
  saveProgress();
}

function newGame(diffKey) {
  applyCompletedUi(false, { silent: true });
  applyPausedUi(false, { silent: true });

  setStatus("Generating puzzle…", "info");
  const sol = generateFullSolution();
  const puz = makePuzzleFromSolution(sol, diffKey);
  setFromPuzzle(puz, sol, diffKey);
}

// -------- Events --------

// Keypad numbers
document.addEventListener("click", (e) => {
  // If paused/completed, ignore everything except overlay buttons
  if (isLocked()) return;

  const numBtn = e.target.closest(".keyNum");
  if (numBtn) {
    if (selected === -1) return;
    const k = Number(numBtn.dataset.key);
    setValue(selected, k);
    return;
  }

  if (!e.target.closest(".menu")) {
    closeDetails(appMenuEl);
    closeDetails(newMenuEl);
  }
});

// Control row
btnCheck.addEventListener("click", checkConflicts);
btnNotes.addEventListener("click", toggleNotes);
btnUndo.addEventListener("click", undo);
btnRedo.addEventListener("click", redo);
btnErase.addEventListener("click", eraseSelected);

// Pause only pauses (not when completed)
btnPause.addEventListener("click", () => {
  if (paused || completed) return;
  applyPausedUi(true);
});

// Resume lives on overlay
btnResume.addEventListener("click", () => applyPausedUi(false));

// Completed overlay buttons
btnCompleteNew?.addEventListener("click", () => {
  applyCompletedUi(false, { silent: true });
  newGame(currentDifficulty);
});
btnCompleteClose?.addEventListener("click", () => {
  // Close overlay and leave board interactive (still solved)
  applyCompletedUi(false, { silent: true });
  setStatus("Solved! 🎉", "good");
});

// Menu items
btnContinue.addEventListener("click", () => {
  closeDetails(appMenuEl);
  continueLastGame();
});
btnReset.addEventListener("click", () => {
  closeDetails(appMenuEl);
  resetToGivens();
});
btnSolve.addEventListener("click", () => {
  closeDetails(appMenuEl);
  fillSolution();
});

// New menu difficulty buttons
document.querySelectorAll(".newDiff").forEach((b) => {
  b.addEventListener("click", () => {
    const diff = b.dataset.diff;
    closeDetails(newMenuEl);
    newGame(diff);
  });
});

// Save on close/background
window.addEventListener("beforeunload", () => saveProgress());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveProgress();
});

// click outside board to clear selection
document.addEventListener("mousedown", (e) => {
  if (isLocked()) return;
  if (!e.target.closest(".cell") && !e.target.closest(".keypadRow") && !e.target.closest(".controlRow") && !e.target.closest(".gameTop")) {
    selected = -1;
    render();
  }
});

// -------- Boot --------
function boot() {
  buildBoard();
  setNewDifficultyLabel(currentDifficulty);
  updateContinueButton();

  const u = new URL(window.location.href);
  const p = u.searchParams.get("p");
  const s = u.searchParams.get("s");

  const pGrid = decodeGrid(p);
  const sGrid = decodeGrid(s);

  if (pGrid && sGrid) {
    const puzzleStr = encodeGrid(pGrid);
    const restored = loadProgressIfAny(puzzleStr);
    if (!restored) {
      setFromPuzzle(pGrid, sGrid, currentDifficulty);
      setStatus("Loaded puzzle from URL.", "info");
    }
  } else {
    const last = getLastPuzzleStr();
    if (last && last.length === 81 && hasSavedPuzzle(last)) {
      continueLastGame();
    } else {
      newGame(currentDifficulty);
    }
  }
}

boot();
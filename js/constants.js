/**
 * Shared constants and small pure helpers used across every module.
 * Loaded first; everything here is global (classic-script, no bundler needed).
 */

// Canonical operator glyphs. We always store/compare operators as these exact
// characters so that feedback, validation and rendering never disagree.
const OPS = ['+', '−', '×', '÷'];

// Evaluate an equation given numeric operands and a canonical operator glyph.
function evaluateEquation(a, op, b) {
  switch (op) {
    case '+': return a + b;
    case '−': return a - b;
    case '×': return a * b;
    case '÷': return b !== 0 ? a / b : NaN;
    default:  return NaN;
  }
}

// Division is only legal when it comes out to a whole number.
function isExactDivision(a, b) {
  return b !== 0 && a % b === 0;
}

// Format a number with thousands separators, e.g. 154872 -> "154,872".
function formatNumber(n) {
  return Number(n).toLocaleString('en-US');
}

// True when every digit of n is identical (111, 222, 999, ...).
function isRepdigit(n) {
  const s = String(n);
  return s.split('').every((c) => c === s[0]);
}

// Three-character digit array for a 3-digit operand, e.g. 482 -> ['4','8','2'].
function digits3(n) {
  return String(n).padStart(3, '0').split('');
}

// The "blank" token used by Equation mode to left-pad a number into a
// fixed-width field. It is a first-class symbol: it gets Wordle-graded like a
// digit, so a green blank tells you a leading position is empty (the number is
// shorter than the field).
const BLANK = '·';

// Left-pad a number into `width` cells using BLANK, e.g. 7 -> ['·','7'] and
// 1 over width 4 -> ['·','·','·','1'].
function padCells(n, width) {
  const s = String(n);
  const out = new Array(width).fill(BLANK);
  for (let i = 0; i < s.length; i++) out[width - s.length + i] = s[i];
  return out;
}

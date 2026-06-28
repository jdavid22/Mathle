/**
 * Equation mode (Nerdle-style).
 *
 * The whole equation is hidden: two 2-digit operands, an operator, and a
 * 4-digit result — all guessed. Guesses must be true equations ("equal out").
 * Numbers are shown in fixed-width fields left-padded with the BLANK token, and
 * BLANK is graded like any other symbol (a green blank = "this number is
 * shorter than the field").
 *
 * This file bundles the four mode-specific collaborators so Equation mode can be
 * swapped in alongside Classic without disturbing it:
 *   EquationFeedback   — field-aware Wordle grading + signatures
 *   EquationEngine     — the ~25k valid-equation universe + consistency filter
 *   EquationGenerator  — picks a non-trivial hidden equation
 *   EquationValidator  — validates a typed guess and that it balances
 */

// Field widths: operand, operand, result.
const EQ_A_WIDTH = 2;
const EQ_B_WIDTH = 2;
const EQ_C_WIDTH = 4;

class EquationFeedback {
  // Two-pass Wordle grading over one fixed-width field (BLANK is a real token).
  gradeField(guessCells, solCells) {
    const res = guessCells.map(() => 'absent');
    const counts = {};
    for (const c of solCells) counts[c] = (counts[c] || 0) + 1;
    for (let i = 0; i < guessCells.length; i++) {
      if (guessCells[i] === solCells[i]) {
        res[i] = 'correct';
        counts[guessCells[i]]--;
      }
    }
    for (let i = 0; i < guessCells.length; i++) {
      if (res[i] === 'correct') continue;
      const c = guessCells[i];
      if (counts[c] > 0) {
        res[i] = 'present';
        counts[c]--;
      }
    }
    return res;
  }

  gradeOperator(g, s) {
    return g === s ? 'correct' : 'absent';
  }

  hint(g, s) {
    if (g < s) return 'up';
    if (g > s) return 'down';
    return 'equal';
  }

  // Full feedback for {a, op, b, c} guess vs solution.
  grade(guess, sol) {
    return {
      first: this.gradeField(padCells(guess.a, EQ_A_WIDTH), padCells(sol.a, EQ_A_WIDTH)),
      operator: this.gradeOperator(guess.op, sol.op),
      second: this.gradeField(padCells(guess.b, EQ_B_WIDTH), padCells(sol.b, EQ_B_WIDTH)),
      result: this.gradeField(padCells(guess.c, EQ_C_WIDTH), padCells(sol.c, EQ_C_WIDTH)),
      firstHint: this.hint(guess.a, sol.a),
      secondHint: this.hint(guess.b, sol.b),
    };
  }

  _cells(fb) {
    const f = fb.first.map((s) => s[0]).join('');
    const s = fb.second.map((s) => s[0]).join('');
    const r = fb.result.map((s) => s[0]).join('');
    return `${f}|${fb.operator[0]}|${s}|${r}`;
  }

  signature(fb) {
    return `${this._cells(fb)}|${fb.firstHint[0]}${fb.secondHint[0]}`;
  }

  signatureNoHints(fb) {
    return this._cells(fb);
  }

  isWin(fb) {
    return (
      fb.first.every((s) => s === 'correct') &&
      fb.operator === 'correct' &&
      fb.second.every((s) => s === 'correct') &&
      fb.result.every((s) => s === 'correct')
    );
  }
}

class EquationEngine {
  constructor(feedback) {
    this.fb = feedback;
    this._universe = null; // built once, shared by every Equation puzzle
  }

  // Every valid equation with 1–99 operands and a 1–9999 result.
  universe() {
    if (this._universe) return this._universe;
    const U = [];
    for (let a = 1; a <= 99; a++) {
      for (let b = 1; b <= 99; b++) {
        for (const op of OPS) {
          if (op === '−' && a - b <= 0) continue;
          if (op === '÷' && a % b !== 0) continue;
          const c = evaluateEquation(a, op, b);
          if (c < 1 || c > 9999) continue;
          U.push({ a, op, b, c });
        }
      }
    }
    this._universe = U;
    return U;
  }

  filter(candidates, guess, observedSignature, useHints = true) {
    return candidates.filter((cand) => {
      const fb = this.fb.grade(guess, cand);
      const sig = useHints ? this.fb.signature(fb) : this.fb.signatureNoHints(fb);
      return sig === observedSignature;
    });
  }
}

class EquationGenerator {
  // Reject degenerate equations that wouldn't be satisfying to deduce.
  isTrivial(a, b, op, c) {
    if (a === b) return true;                       // 50+50, a÷a=1, a−a=0
    if (op === '×' && (a === 1 || b === 1)) return true; // ×1 is a no-op
    if (op === '÷' && b === 1) return true;          // a÷1 = a
    if (a < 10 && b < 10 && c < 10) return true;     // single-digit triviality
    return false;
  }

  randomEquation(rng) {
    const op = rng.pick(OPS);
    let a, b;
    if (op === '÷') {
      // Build an exact division: dividend = divisor × quotient, kept ≤ 99.
      const q = rng.int(2, 9);
      const maxB = Math.floor(99 / q);
      b = rng.int(2, Math.max(2, maxB));
      a = b * q;
    } else if (op === '−') {
      a = rng.int(11, 99);
      b = rng.int(1, a - 1);
    } else {
      a = rng.int(1, 99);
      b = rng.int(1, 99);
    }
    return { a, op, b };
  }

  generate(rng) {
    let fallback = null;
    for (let i = 0; i < 3000; i++) {
      const { a, op, b } = this.randomEquation(rng);
      if (op === '÷' && a % b !== 0) continue;
      const c = evaluateEquation(a, op, b);
      if (c < 1 || c > 9999) continue;
      // result + both operands carry data; store c as `result` too for reuse.
      const puzzle = { a, op, b, c, result: c };
      if (this.isTrivial(a, b, op, c)) continue;
      if (!fallback) fallback = puzzle;
      return puzzle;
    }
    return fallback;
  }
}

class EquationValidator {
  validate(firstStr, op, secondStr, resultStr) {
    if (!firstStr.length) return { ok: false, message: 'Enter the first number.' };
    if (!op) return { ok: false, message: 'Choose an operator.' };
    if (!secondStr.length) return { ok: false, message: 'Enter the second number.' };
    if (!resultStr.length) return { ok: false, message: 'Enter the result, then ↵.' };

    const a = parseInt(firstStr, 10);
    const b = parseInt(secondStr, 10);
    const c = parseInt(resultStr, 10);

    if (a < 1 || a > 99 || b < 1 || b > 99) {
      return { ok: false, message: 'Numbers must be 1–99.' };
    }
    if (op === '÷' && a % b !== 0) {
      return { ok: false, message: 'That division isn’t a whole number.' };
    }
    if (op === '−' && a - b < 0) {
      return { ok: false, message: 'Result can’t be negative.' };
    }

    const actual = evaluateEquation(a, op, b);
    if (actual !== c) {
      // Reveal the guess's own arithmetic (not the answer) so the rule is clear.
      return { ok: false, message: `Doesn’t balance: ${a} ${op} ${b} = ${actual}.` };
    }
    return { ok: true, a, op, b, c };
  }
}

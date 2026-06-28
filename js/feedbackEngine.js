/**
 * Feedback Engine.
 *
 * Grades a guess against a solution using official Wordle duplicate rules,
 * grades the operator, and computes per-operand higher/lower hints based on the
 * FULL numeric value of each operand (never digit-by-digit).
 *
 * The `signature` it produces doubles as the key the Entropy Calculator uses to
 * test whether a candidate equation is still consistent with what the player has
 * been told: a candidate is possible iff grading the guess against that
 * candidate yields the same signature the player actually received.
 */
class FeedbackEngine {
  // Two-pass Wordle grading for one 3-digit operand.
  // Returns an array of 'correct' | 'present' | 'absent'.
  gradeOperand(guessDigits, solDigits) {
    const result = new Array(guessDigits.length).fill('absent');
    const counts = {};
    for (const d of solDigits) counts[d] = (counts[d] || 0) + 1;

    // Pass 1: exact-position matches consume a copy of that digit.
    for (let i = 0; i < guessDigits.length; i++) {
      if (guessDigits[i] === solDigits[i]) {
        result[i] = 'correct';
        counts[guessDigits[i]]--;
      }
    }
    // Pass 2: remaining digits are "present" only while copies are left.
    for (let i = 0; i < guessDigits.length; i++) {
      if (result[i] === 'correct') continue;
      const d = guessDigits[i];
      if (counts[d] > 0) {
        result[i] = 'present';
        counts[d]--;
      }
    }
    return result;
  }

  gradeOperator(guessOp, solOp) {
    return guessOp === solOp ? 'correct' : 'absent';
  }

  // 'up'   -> the hidden operand is higher than the guess (guess too low)
  // 'down' -> the hidden operand is lower  than the guess (guess too high)
  // 'equal'-> exact match
  hint(guessVal, solVal) {
    if (guessVal < solVal) return 'up';
    if (guessVal > solVal) return 'down';
    return 'equal';
  }

  // Full feedback object for {a, op, b} numeric guess vs numeric solution.
  grade(guess, solution) {
    return {
      first: this.gradeOperand(digits3(guess.a), digits3(solution.a)),
      operator: this.gradeOperator(guess.op, solution.op),
      second: this.gradeOperand(digits3(guess.b), digits3(solution.b)),
      firstHint: this.hint(guess.a, solution.a),
      secondHint: this.hint(guess.b, solution.b),
    };
  }

  // Compact comparable string of an entire feedback object.
  signature(fb) {
    const f = fb.first.map((s) => s[0]).join('');
    const s = fb.second.map((x) => x[0]).join('');
    return `${f}|${fb.operator[0]}|${s}|${fb.firstHint[0]}${fb.secondHint[0]}`;
  }

  isWin(fb) {
    return (
      fb.first.every((s) => s === 'correct') &&
      fb.operator === 'correct' &&
      fb.second.every((s) => s === 'correct')
    );
  }
}

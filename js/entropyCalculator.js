/**
 * Entropy Calculator.
 *
 * The displayed target result is fixed and known, so the space of "possible
 * hidden equations" is exactly every valid (a, op, b) with 3-digit operands
 * that evaluates to that result. We enumerate that space once, then shrink it
 * after each guess by keeping only candidates whose feedback signature matches
 * the feedback the player actually received. The size of the surviving set is
 * the live "remaining possibilities" reading.
 */
class EntropyCalculator {
  constructor(feedbackEngine) {
    this.fb = feedbackEngine;
  }

  // Every legal 3-digit equation that produces `result`, across all operators.
  buildCandidates(result) {
    const candidates = [];

    // Multiplication: a × b = result  (iterate divisors that are 3-digit).
    for (let a = 100; a <= 999; a++) {
      if (result % a === 0) {
        const b = result / a;
        if (b >= 100 && b <= 999) candidates.push({ a, op: '×', b });
      }
    }
    // Addition: a + b = result.
    for (let a = 100; a <= 999; a++) {
      const b = result - a;
      if (b >= 100 && b <= 999) candidates.push({ a, op: '+', b });
    }
    // Subtraction: a − b = result (result is always ≥ 0 by construction).
    for (let a = 100; a <= 999; a++) {
      const b = a - result;
      if (b >= 100 && b <= 999) candidates.push({ a, op: '−', b });
    }
    // Division: a ÷ b = result.
    if (result >= 1) {
      for (let b = 100; b <= 999; b++) {
        const a = result * b;
        if (a >= 100 && a <= 999) candidates.push({ a, op: '÷', b });
      }
    }
    return candidates;
  }

  // Keep only candidates that would have produced the same feedback signature.
  // `useHints` chooses whether the higher/lower channel is part of the match.
  filter(candidates, guess, observedSignature, useHints = true) {
    return candidates.filter((cand) => {
      const fb = this.fb.grade(guess, cand);
      const sig = useHints ? this.fb.signature(fb) : this.fb.signatureNoHints(fb);
      return sig === observedSignature;
    });
  }
}

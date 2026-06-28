/**
 * Puzzle Generator.
 *
 * Produces a hidden equation that satisfies all design constraints:
 *   - both operands are exactly 3 digits (100–999)
 *   - operator chosen from + − × ÷
 *   - division is always exact; subtraction never negative
 *   - no trivial patterns (repdigits, equal operands, round hundreds)
 *   - a candidate space large enough that the deduction is interesting
 *
 * Generation is driven entirely by the supplied random source, so passing a
 * SeededRandom yields a deterministic puzzle (Daily mode).
 */
class PuzzleGenerator {
  constructor(entropyCalculator) {
    this.entropy = entropyCalculator;
  }

  // Reject obviously trivial / unsatisfying operand pairings.
  isTrivial(a, b) {
    if (isRepdigit(a) || isRepdigit(b)) return true;   // 111, 222, 999, ...
    if (a === b) return true;                          // 500 + 500, etc.
    if (a % 100 === 0 || b % 100 === 0) return true;   // round hundreds / ×100
    return false;
  }

  // One raw candidate equation, sampled to respect each operator's domain.
  randomEquation(rng) {
    const op = rng.pick(OPS);
    let a, b;
    if (op === '+') {
      a = rng.int(100, 999);
      b = rng.int(100, 999);
    } else if (op === '−') {
      a = rng.int(100, 999);
      b = rng.int(100, a); // guarantees a − b ≥ 0
    } else if (op === '×') {
      a = rng.int(100, 999);
      b = rng.int(100, 999);
    } else {
      // Division: pick a quotient and a divisor so the dividend stays 3-digit.
      const q = rng.int(2, 9); // q = 1 would mean a === b (trivial)
      const maxB = Math.floor(999 / q);
      b = rng.int(100, maxB);
      a = b * q;
    }
    return { a, op, b };
  }

  // Keep sampling until we find a non-trivial puzzle with a healthy candidate
  // space. Falls back to the first acceptable puzzle if the ideal range proves
  // hard to hit for this particular operator.
  generate(rng) {
    let fallback = null;

    for (let i = 0; i < 4000; i++) {
      const eq = this.randomEquation(rng);
      const result = evaluateEquation(eq.a, eq.op, eq.b);

      if (!(result > 0)) continue;
      if (eq.op === '÷' && !isExactDivision(eq.a, eq.b)) continue;
      if (this.isTrivial(eq.a, eq.b)) continue;

      const candidateCount = this.entropy.buildCandidates(result).length;
      const puzzle = { ...eq, result, candidateCount };
      if (!fallback) fallback = puzzle;

      // "Good" puzzle: enough alternatives for the meter to narrow visibly,
      // but not an overwhelming haystack.
      if (candidateCount >= 3 && candidateCount <= 6000) return puzzle;
    }
    return fallback;
  }
}

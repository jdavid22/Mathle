/**
 * Guess Validator.
 *
 * Players type two 3-digit operands and an operator; the game computes the
 * result for them. This module turns raw input strings into a validated numeric
 * guess, or an explanatory rejection message.
 */
class GuessValidator {
  validate(firstStr, op, secondStr) {
    if (firstStr.length !== 3 || secondStr.length !== 3) {
      return { ok: false, message: 'Enter two 3-digit numbers.' };
    }
    if (!op) {
      return { ok: false, message: 'Choose an operator.' };
    }

    const a = parseInt(firstStr, 10);
    const b = parseInt(secondStr, 10);

    // Leading-zero inputs like "012" parse below 100 and aren't 3-digit numbers.
    if (a < 100) return { ok: false, message: 'First number must be 100–999.' };
    if (b < 100) return { ok: false, message: 'Second number must be 100–999.' };

    if (op === '−' && a - b < 0) {
      return { ok: false, message: 'Subtraction can’t be negative.' };
    }
    if (op === '÷' && !isExactDivision(a, b)) {
      return { ok: false, message: 'Division must come out even.' };
    }

    return { ok: true, a, op, b, result: evaluateEquation(a, op, b) };
  }
}

# Mathle — a Math Wordle

A polished, mobile-friendly browser game inspired by Wordle, but with arithmetic
equations instead of words. Pure HTML/CSS/JS — no backend, no frameworks, no build step.

## How to play

The **target result** is shown from the start. Discover the hidden equation that
produces it: a three-digit number, an operator (`+ − × ÷`), and another
three-digit number. The result is computed for you — you never type it.

After each guess:

- **Digit colors** (official Wordle duplicate rules, graded per operand)
  - 🟩 right digit, right position
  - 🟨 digit is elsewhere in that number
  - ⬜ digit not in that number
- **Operator** turns 🟩 when correct, ⬜ otherwise.
- **↑ / ↓ hints** per operand, compared by full numeric value (not digit position).
- **Remaining possibilities** meter — how many equations still fit everything you
  know. It narrows live as you deduce.

Six guesses. Win or the answer is revealed.

## Modes

- **Daily** — one deterministic puzzle per calendar day, identical for everyone.
  Progress is saved, so a refresh resumes where you left off.
- **Unlimited** — endless random puzzles. Toggle with the ⇄ button.

## Features

- Dark mode, responsive phone layout, on-screen keypad + physical keyboard input
- Tile-flip, win-bounce, invalid-shake, and smooth counter animations
- Local statistics (games, win %, streaks, guess distribution)
- Emoji **share** grid, **colorblind** mode (blue/orange)

## Running it

Just open `index.html` in a browser. To serve it locally instead:

```bash
node .claude/serve.js   # http://localhost:4173
```

## Architecture

Each module is a single-responsibility class in `js/` (loaded as classic scripts
in dependency order from `index.html`):

| File | Responsibility |
| --- | --- |
| `constants.js` | operator glyphs + pure helpers (evaluate, format, digits) |
| `rng.js` | seeded PRNG (Daily) and live random (Unlimited) |
| `puzzleGenerator.js` | builds a valid, non-trivial hidden equation |
| `guessValidator.js` | turns raw input into a validated numeric guess |
| `feedbackEngine.js` | Wordle grading, operator grade, higher/lower hints |
| `entropyCalculator.js` | enumerates & filters the remaining-possibility space |
| `statisticsManager.js` | localStorage stats |
| `dailyPuzzle.js` | date-seeded puzzle + Daily progress persistence |
| `uiRenderer.js` | all DOM rendering (board, meter, keypad, modals) |
| `main.js` | `Game` controller wiring it together |

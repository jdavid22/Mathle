# Mathle — a Math Wordle

A polished, mobile-friendly browser game inspired by Wordle and Nerdle, but with
arithmetic equations instead of words. Pure HTML/CSS/JS — no backend, no
frameworks, no build step.

## How to play

Nothing is shown — you deduce the whole hidden equation. Guess two numbers
(1–99), an operator (`+ − × ÷`), and the answer: type the first number, an
operator, the second number, press `=`, then the answer, then Enter. Your guess
must be a true equation that **balances**.

After each guess:

- **Symbol colors** (official Wordle duplicate rules, graded per field)
  - 🟩 right symbol, right position
  - 🟨 symbol is elsewhere in that field
  - ⬜ symbol not in that field
- Numbers sit in fixed-width boxes left-padded with **blanks**, and blanks are
  graded too — a green blank means that number is shorter than its box.
- **▲ Higher / ▼ Lower** pills under each number, compared by full value.
- **Remaining possibilities** meter — how many equations still fit everything you
  know (~25k to start). It narrows live as you deduce.

Six guesses. Win or the answer is revealed.

## Modes

- **Daily** — one deterministic puzzle per calendar day, identical for everyone.
  Progress is saved, so a refresh resumes where you left off.
- **Unlimited** — endless random puzzles. Toggle with the ⇄ button; ↻ rerolls.

## Features

- Locked to one non-scrolling screen on phones (the board auto-scales to fit)
- Dark mode, on-screen keypad + physical keyboard input
- Tile-flip, win-bounce, invalid-shake, and smooth counter animations
- Local statistics (games, win %, streaks, guess distribution, wrong answers)
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
| `constants.js` | operator glyphs + pure helpers (evaluate, format, blank-pad) |
| `rng.js` | seeded PRNG (Daily) and live random (Unlimited) |
| `equationMode.js` | feedback grading, the valid-equation universe, generator, validator |
| `statisticsManager.js` | localStorage stats |
| `dailyPuzzle.js` | date-seeded puzzle + Daily progress persistence |
| `uiRenderer.js` | all DOM rendering (board, meter, keypad, modals) |
| `main.js` | `Game` controller wiring it together |

/**
 * Game controller.
 *
 * Wires the modules together, owns game state and input handling, and tells the
 * UI renderer when to redraw. The game is the hidden-equation (Nerdle-style)
 * puzzle: two 1–2 digit operands, an operator, and a 4-digit answer, all guessed
 * and graded. Two schedules: deterministic Daily and random Unlimited.
 *
 * Input fills in order: first operand → operator → second operand → (=) →
 * result → Enter.
 */
class Game {
  constructor() {
    this.feedback = new EquationFeedback();
    this.engine = new EquationEngine(this.feedback);
    this.generator = new EquationGenerator();
    this.validator = new EquationValidator();
    this.daily = new DailyPuzzle(this.generator, 'mathle-daily-eq', 'eq');
    this.stats = new StatisticsManager();
    this.ui = new UIRenderer();

    this.maxGuesses = 6;
    this.mode = 'daily'; // daily | unlimited

    if (localStorage.getItem('mathle-colorblind') === '1') {
      document.body.classList.add('colorblind');
    }
    this._applyTheme();

    this._bindControls();
    this._bindInput();
    this.newGame('daily');

    // Pop the help on load, unless a finished Daily is showing or the player
    // ticked "Don't show automatically".
    const helpHidden = localStorage.getItem('mathle-help-hidden') === '1';
    if (this.status === 'playing' && !helpHidden) this.ui.openModal('help-modal');
    // Re-fit once layout (and fonts) have fully settled.
    requestAnimationFrame(() => this.ui._fitBoard());
  }

  // ---- Lifecycle ---------------------------------------------------------

  newGame(mode) {
    this.ui.closeModals();
    this.mode = mode;
    this.input = { first: '', op: null, second: '', result: '', phase: 'a' };
    this.guesses = [];
    this.status = 'playing';
    this.justSubmitted = false;
    this._recorded = false;
    this.gameMiscalcs = 0; // unbalanced guesses this round (not shared)

    if (mode === 'daily') {
      const info = this.daily.generateForToday();
      this.puzzle = info.puzzle;
      this.dailyDate = info.date;
      this.dailyNumber = info.number;
    } else {
      this.puzzle = this.generator.generate(new LiveRandom());
      this.dailyNumber = null;
    }

    // The possibility space is the whole valid-equation universe; it shrinks as
    // feedback accumulates.
    this.candidates = this.engine.universe().slice();
    this.initialCount = this.candidates.length;

    this.ui.renderModeBadge(this.mode, this.dailyNumber);
    if (mode === 'daily') this._restoreDailyProgress();

    this.render();
    this.ui.renderEntropy(this.candidates.length, this.candidates.length, this.initialCount);
    if (this.status !== 'playing') this._showEndState();
  }

  // Replay any saved Daily guesses so a refresh resumes the same board.
  _restoreDailyProgress() {
    const saved = this.daily.loadProgress(this.dailyDate);
    if (!saved || !saved.guesses) return;
    for (const g of saved.guesses) {
      this._applyGuess(g.a, g.op, g.b, evaluateEquation(g.a, g.op, g.b), false);
    }
    this.status = saved.status || this.status;
    this.gameMiscalcs = saved.miscalcs || 0;
  }

  // ---- Input handling ----------------------------------------------------

  handleKey(key) {
    if (this.status !== 'playing') return;
    if (key === 'enter') return this.submit();
    if (key === 'del') return this._delete();
    if (key === '=') return this._equals();
    if (/^[0-9]$/.test(key)) return this._addDigit(key);
    if (OPS.includes(key)) return this._setOperator(key);
  }

  _addDigit(d) {
    this.ui.spawnBoo(d); // seasonal flourish (no-op unless the Halloween theme is on)
    const I = this.input;
    if (I.phase === 'a') {
      I.first = this._appendDigit(I.first, d, 2);
    } else if (I.phase === 'b') {
      I.second = this._appendDigit(I.second, d, 2);
      // A full two-digit second operand advances to the answer on its own, so
      // "12 × 34" flows straight into the answer with no "=". (A one-digit
      // second operand still needs "=" to mark where it ends.)
      if (I.second.length === 2) I.phase = 'c';
    } else if (I.phase === 'c') {
      I.result = this._appendDigit(I.result, d, 4);
    }
    this.render();
  }

  // Append a digit within a field's width. A leading zero is treated as a blank
  // (typing "0" then "7" gives 7, shown as blank + 7) — friendlier entry of
  // single-digit numbers for new players.
  _appendDigit(current, d, maxLen) {
    if (current.length >= maxLen) return current;
    return (current + d).replace(/^0+(?=\d)/, '');
  }

  _setOperator(op) {
    const I = this.input;
    if (I.phase === 'a' && I.first.length >= 1) {
      I.op = op;
      I.phase = 'b';
      this.render();
    }
  }

  _equals() {
    const I = this.input;
    if (I.phase === 'b' && I.second.length >= 1) {
      I.phase = 'c';
      this.render();
    }
  }

  _delete() {
    const I = this.input;
    if (I.phase === 'c') {
      if (I.result.length) I.result = I.result.slice(0, -1);
      else I.phase = 'b';
    } else if (I.phase === 'b') {
      if (I.second.length) I.second = I.second.slice(0, -1);
      else { I.op = null; I.phase = 'a'; }
    } else if (I.first.length) {
      I.first = I.first.slice(0, -1);
    }
    this.render();
  }

  submit() {
    const I = this.input;
    const check = this.validator.validate(I.first, I.op, I.second, I.result);
    if (!check.ok) {
      // Track answers that don't match the player's own operands (e.g. 10×11=119),
      // both for this round and lifetime.
      if (check.reason === 'unbalanced') {
        this.gameMiscalcs++;
        this.stats.recordMiscalc();
        if (this.mode === 'daily') this._saveDaily();
      }
      this.ui.showToast(check.message);
      this.ui.shakeCurrentRow();
      return;
    }
    this.input = { first: '', op: null, second: '', result: '', phase: 'a' };
    this._applyGuess(check.a, check.op, check.b, check.c, true);
    if (this.mode === 'daily') this._saveDaily();
  }

  _saveDaily() {
    this.daily.saveProgress(this.dailyDate, {
      guesses: this.guesses.map((g) => ({ a: g.a, op: g.op, b: g.b })),
      status: this.status,
      miscalcs: this.gameMiscalcs,
    });
  }

  // Grade a guess, shrink the possibility space, and maybe end the game.
  // `animate` drives the reveal + entropy counter; false when replaying Daily.
  _applyGuess(a, op, b, c, animate) {
    const guess = { a, op, b, c };
    const fb = this.feedback.grade(guess, this.puzzle);
    this.guesses.push({ a, op, b, c, fb });

    const before = this.candidates.length;
    this.candidates = this.engine.filter(this.candidates, guess, this.feedback.signature(fb));

    this.justSubmitted = animate;
    if (this.feedback.isWin(fb)) this.status = 'won';
    else if (this.guesses.length >= this.maxGuesses) this.status = 'lost';

    this.render();
    if (animate) {
      this.ui.renderEntropy(before, this.candidates.length, this.initialCount);
      if (this.status !== 'playing') {
        this._recordOnce();
        setTimeout(() => this._showEndState(), 1100); // let the reveal play first
      }
    }
    this.justSubmitted = false;
  }

  _recordOnce() {
    if (this._recorded) return;
    this._recorded = true;
    this.stats.record(this.status === 'won', this.guesses.length);
  }

  // ---- End state ---------------------------------------------------------

  _showEndState() {
    this._recorded = true;
    this.ui.showGameOver({
      won: this.status === 'won',
      solution: this.puzzle,
      guessesUsed: this.guesses.length,
      maxGuesses: this.maxGuesses,
      miscalcs: this.gameMiscalcs,
    });
  }

  // ---- Sharing -----------------------------------------------------------

  shareText() {
    const hw = this.halloween; // Halloween share swaps present→orange, absent→black
    const name = hw ? '🎃 Mathle' : 'Mathle';
    const head = this.mode === 'daily' ? `${name} #${this.dailyNumber}` : `${name} Unlimited`;
    const score = this.status === 'won' ? this.guesses.length : 'X';
    const sq = hw
      ? { correct: '🟩', present: '🟧', absent: '⬛' }
      : { correct: '🟩', present: '🟨', absent: '⬜' };
    const opSq = (s) => (s === 'correct' ? '🟩' : hw ? '⬛' : '⬜');
    const lines = this.guesses.map((g) => {
      const first = g.fb.first.map((s) => sq[s]).join('');
      const second = g.fb.second.map((s) => sq[s]).join('');
      const result = g.fb.result.map((s) => sq[s]).join('');
      return `${first}${opSq(g.fb.operator)}${second}${result}`;
    });
    const url = `${location.origin}${location.pathname}`;
    return `${head} ${score}/6\n\n${lines.join('\n')}\n\n${url}`;
  }

  // Turn the Halloween skin on for Oct 26–31 (or via ?theme=halloween / ?theme=off).
  _applyTheme() {
    const param = new URLSearchParams(location.search).get('theme');
    let on;
    if (param === 'halloween') on = true;
    else if (param === 'off') on = false;
    else {
      const d = new Date();
      on = d.getMonth() === 9 && d.getDate() >= 26 && d.getDate() <= 31; // October 26–31
    }
    this.halloween = on;
    document.body.classList.toggle('halloween', on);
  }

  async copyShare() {
    try {
      await navigator.clipboard.writeText(this.shareText());
      this.ui.showToast('Results copied!');
    } catch {
      this.ui.showToast('Copy failed');
    }
  }

  // ---- Rendering ---------------------------------------------------------

  render() {
    this.ui.renderBoard(this);
    this.ui.updateKeyboard(this);
  }

  // ---- Wiring ------------------------------------------------------------

  _bindInput() {
    // On-screen keypad (event delegation).
    this.ui.dom.keypad.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-key]');
      if (btn) this.handleKey(btn.dataset.key);
    });

    // Physical keyboard.
    window.addEventListener('keydown', (e) => {
      if (document.getElementById('overlay').classList.contains('open')) return;
      const k = e.key;
      if (k === 'Enter') { this.handleKey('enter'); e.preventDefault(); }
      else if (k === 'Backspace') { this.handleKey('del'); e.preventDefault(); }
      else if (/^[0-9]$/.test(k)) { this.handleKey(k); }
      else if (k === '+') { this.handleKey('+'); }
      else if (k === '-' || k === '_') { this.handleKey('−'); }
      else if (k === '*' || k.toLowerCase() === 'x') { this.handleKey('×'); }
      else if (k === '/') { this.handleKey('÷'); e.preventDefault(); }
      else if (k === '=') { this.handleKey('='); }
    });

    // Keep the board scaled to fit whenever the viewport changes.
    window.addEventListener('resize', () => this.ui._fitBoard());
    window.addEventListener('orientationchange', () =>
      setTimeout(() => this.ui._fitBoard(), 150)
    );
  }

  _bindControls() {
    const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);

    on('mode-toggle', () => {
      this.newGame(this.mode === 'daily' ? 'unlimited' : 'daily');
      this.ui.showToast(this.mode === 'daily' ? 'Daily puzzle' : 'Unlimited puzzles');
    });
    on('new-game-btn', () => {
      this._recorded = false;
      if (this.mode === 'unlimited') {
        this.newGame('unlimited');
        this.ui.showToast('New puzzle');
      } else {
        this.newGame('daily');
        this.ui.showToast('Daily puzzle reloaded');
      }
    });

    on('help-btn', () => this.ui.openModal('help-modal'));
    const dismiss = document.getElementById('help-dismiss');
    dismiss.checked = localStorage.getItem('mathle-help-hidden') === '1';
    dismiss.addEventListener('change', () => {
      try {
        localStorage.setItem('mathle-help-hidden', dismiss.checked ? '1' : '0');
      } catch { /* ignore */ }
    });
    on('stats-btn', () => {
      this.ui.renderStats(this.stats.stats, this.stats);
      this.ui.openModal('stats-modal');
    });
    on('colorblind-btn', () => this._toggleColorblind());

    on('overlay', () => this.ui.closeModals());
    document.querySelectorAll('[data-close]').forEach((el) =>
      el.addEventListener('click', () => this.ui.closeModals())
    );

    on('share-btn', () => this.copyShare());
    on('playagain-btn', () => {
      this.ui.closeModals();
      this._recorded = false;
      this.newGame('unlimited'); // Daily can't be replayed; offer a fresh one
    });
  }

  _toggleColorblind() {
    const on = document.body.classList.toggle('colorblind');
    try {
      localStorage.setItem('mathle-colorblind', on ? '1' : '0');
    } catch { /* ignore */ }
    this.ui.showToast(on ? 'Colorblind mode on' : 'Colorblind mode off');
  }
}

// Boot once the DOM is ready (scripts load at end of body, so it already is).
window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
});

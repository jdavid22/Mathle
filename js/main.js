/**
 * Game controller.
 *
 * Wires the modules together, owns game state and input handling, and tells the
 * UI renderer when to redraw. Two modes: deterministic Daily and random
 * Unlimited. Input model mirrors a calculator: three digits, an operator, three
 * more digits, then Enter.
 */
class Game {
  constructor() {
    this.feedback = new FeedbackEngine();
    this.entropy = new EntropyCalculator(this.feedback);
    this.generator = new PuzzleGenerator(this.entropy);
    this.validator = new GuessValidator();
    this.stats = new StatisticsManager();
    this.daily = new DailyPuzzle(this.generator);
    this.ui = new UIRenderer();

    this.maxGuesses = 6;
    this.mode = 'daily';

    this._bindGlobalControls();
    this._bindInput();
    this.newGame('daily');
  }

  // ---- Lifecycle ---------------------------------------------------------

  newGame(mode) {
    this.mode = mode;
    this.input = { first: '', op: null, second: '' };
    this.guesses = [];
    this.status = 'playing';
    this.justSubmitted = false;

    if (mode === 'daily') {
      const info = this.daily.generateForToday();
      this.puzzle = info.puzzle;
      this.dailyDate = info.date;
      this.dailyNumber = info.number;
    } else {
      this.puzzle = this.generator.generate(new LiveRandom());
      this.dailyNumber = null;
    }

    this.candidates = this.entropy.buildCandidates(this.puzzle.result);
    this.initialCount = this.candidates.length;
    this.prevCount = this.candidates.length;

    this.ui.renderTarget(this.puzzle.result);
    this.ui.renderModeBadge(this.mode, this.dailyNumber);

    if (mode === 'daily') this._restoreDailyProgress();

    this.render();
    this.ui.renderEntropy(this.candidates.length, this.candidates.length, this.initialCount);
    if (this.status !== 'playing') this._showEndState(false);
  }

  // Replay any saved Daily guesses so a refresh resumes the same board.
  _restoreDailyProgress() {
    const saved = this.daily.loadProgress(this.dailyDate);
    if (!saved || !saved.guesses) return;
    for (const g of saved.guesses) {
      this._applyGuess(g.a, g.op, g.b, false);
    }
    this.status = saved.status || this.status;
  }

  // ---- Input handling ----------------------------------------------------

  handleKey(key) {
    if (this.status !== 'playing') return;

    if (key === 'enter') return this.submit();
    if (key === 'del') return this._delete();
    if (/^[0-9]$/.test(key)) return this._addDigit(key);
    if (OPS.includes(key)) return this._setOperator(key);
  }

  _addDigit(d) {
    if (!this.input.op) {
      if (this.input.first.length < 3) this.input.first += d;
    } else if (this.input.second.length < 3) {
      this.input.second += d;
    }
    this.render();
  }

  _setOperator(op) {
    // Operator becomes available once the first operand is complete.
    if (this.input.first.length === 3 && this.input.second.length === 0) {
      this.input.op = op;
      this.render();
    }
  }

  _delete() {
    if (this.input.second.length) {
      this.input.second = this.input.second.slice(0, -1);
    } else if (this.input.op) {
      this.input.op = null;
    } else if (this.input.first.length) {
      this.input.first = this.input.first.slice(0, -1);
    }
    this.render();
  }

  submit() {
    const check = this.validator.validate(this.input.first, this.input.op, this.input.second);
    if (!check.ok) {
      this.ui.showToast(check.message);
      this.ui.shakeCurrentRow();
      return;
    }

    // Clear input first so the freshly-graded row renders with an empty
    // current row beneath it (rather than the just-submitted digits).
    this.input = { first: '', op: null, second: '' };
    this._applyGuess(check.a, check.op, check.b, true);

    if (this.mode === 'daily') {
      this.daily.saveProgress(this.dailyDate, {
        guesses: this.guesses.map((g) => ({ a: g.a, op: g.op, b: g.b })),
        status: this.status,
      });
    }
  }

  // Grade a guess, update candidates and possibly end the game.
  // `animate` drives reveal animation + entropy counter; false when replaying.
  _applyGuess(a, op, b, animate) {
    const guess = { a, op, b };
    const fb = this.feedback.grade(guess, this.puzzle);
    const result = evaluateEquation(a, op, b);
    this.guesses.push({ a, op, b, result, fb });

    const before = this.candidates.length;
    this.candidates = this.entropy.filter(this.candidates, guess, this.feedback.signature(fb));

    this.justSubmitted = animate;

    if (this.feedback.isWin(fb)) {
      this.status = 'won';
    } else if (this.guesses.length >= this.maxGuesses) {
      this.status = 'lost';
    }

    this.render();
    if (animate) {
      this.ui.renderEntropy(before, this.candidates.length, this.initialCount);
      if (this.status !== 'playing') {
        this._recordOnce();
        // Let the tile reveal play before the modal slides in.
        setTimeout(() => this._showEndState(true), 1100);
      }
    }
    this.prevCount = this.candidates.length;
    this.justSubmitted = false;
  }

  _recordOnce() {
    if (this._recorded) return;
    this._recorded = true;
    this.stats.record(this.status === 'won', this.guesses.length);
  }

  // ---- End state ---------------------------------------------------------

  _showEndState(record) {
    if (record) this._recorded = true; // already recorded by _recordOnce
    this.ui.showGameOver({
      won: this.status === 'won',
      solution: this.puzzle,
      guessesUsed: this.guesses.length,
      maxGuesses: this.maxGuesses,
    });
  }

  // ---- Sharing -----------------------------------------------------------

  shareText() {
    const head =
      this.mode === 'daily' ? `Mathle Daily #${this.dailyNumber}` : 'Mathle Unlimited';
    const score = this.status === 'won' ? this.guesses.length : 'X';
    const sq = { correct: '🟩', present: '🟨', absent: '⬜' };
    const lines = this.guesses.map((g) => {
      const first = g.fb.first.map((s) => sq[s]).join('');
      const op = g.fb.operator === 'correct' ? '🟩' : '⬜';
      const second = g.fb.second.map((s) => sq[s]).join('');
      return `${first}${op}${second}`;
    });
    return `${head} ${score}/6\n\n${lines.join('\n')}`;
  }

  async copyShare() {
    const text = this.shareText();
    try {
      await navigator.clipboard.writeText(text);
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
    });
  }

  _bindGlobalControls() {
    const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);

    on('mode-toggle', () => this.newGame(this.mode === 'daily' ? 'unlimited' : 'daily'));
    on('new-game-btn', () => {
      // In daily mode "New" just reloads today's puzzle; unlimited gets a fresh one.
      this._recorded = false;
      this.newGame(this.mode === 'unlimited' ? 'unlimited' : 'daily');
    });

    on('help-btn', () => this.ui.openModal('help-modal'));
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
      // Daily can't be replayed; offer a fresh Unlimited puzzle instead.
      this.newGame(this.mode === 'unlimited' ? 'unlimited' : 'unlimited');
    });

    // Restore colourblind preference.
    if (localStorage.getItem('mathle-colorblind') === '1') {
      document.body.classList.add('colorblind');
    }
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

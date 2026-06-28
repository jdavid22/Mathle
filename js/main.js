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
    // Classic mode (result shown, 3-digit operands).
    this.feedback = new FeedbackEngine();
    this.entropy = new EntropyCalculator(this.feedback);
    this.generator = new PuzzleGenerator(this.entropy);
    this.validator = new GuessValidator();
    this.daily = new DailyPuzzle(this.generator, 'mathle-daily');

    // Equation mode (whole equation hidden, 2-digit operands + blanks).
    this.eqFeedback = new EquationFeedback();
    this.eqEngine = new EquationEngine(this.eqFeedback);
    this.eqGenerator = new EquationGenerator();
    this.eqValidator = new EquationValidator();
    this.eqDaily = new DailyPuzzle(this.eqGenerator, 'mathle-daily-eq', 'eq');

    this.stats = new StatisticsManager();
    this.ui = new UIRenderer();

    this.maxGuesses = 6;
    this.mode = 'daily';          // daily | unlimited
    this.gameType = 'classic';    // classic | equation
    this.hints = localStorage.getItem('mathle-hints') !== '0'; // default on

    document.body.classList.toggle('hints-off', !this.hints);
    if (localStorage.getItem('mathle-colorblind') === '1') {
      document.body.classList.add('colorblind');
    }

    this._bindGlobalControls();
    this._bindInput();
    this.newGame('daily');
  }

  get isEquation() {
    return this.gameType === 'equation';
  }

  // ---- Lifecycle ---------------------------------------------------------

  newGame(mode) {
    this.ui.closeModals(); // clear any open modal when starting/switching games
    this.mode = mode;
    this.input = { first: '', op: null, second: '' };
    this.eqInput = { first: '', op: null, second: '', result: '', phase: 'a' };
    this.guesses = [];
    this.status = 'playing';
    this.justSubmitted = false;

    const dailyObj = this.isEquation ? this.eqDaily : this.daily;
    if (mode === 'daily') {
      const info = dailyObj.generateForToday();
      this.puzzle = info.puzzle;
      this.dailyDate = info.date;
      this.dailyNumber = info.number;
    } else {
      this.puzzle = this.isEquation
        ? this.eqGenerator.generate(new LiveRandom())
        : this.generator.generate(new LiveRandom());
      this.dailyNumber = null;
    }

    // Initial possibility space: the full equation universe (Equation) or every
    // equation producing the shown result (Classic).
    this.candidates = this.isEquation
      ? this.eqEngine.universe().slice()
      : this.entropy.buildCandidates(this.puzzle.result);
    this.initialCount = this.candidates.length;
    this.prevCount = this.candidates.length;

    this.ui.applyGameType(this.gameType);
    if (!this.isEquation) this.ui.renderTarget(this.puzzle.result);
    this.ui.renderModeBadge(this.mode, this.dailyNumber, this.gameType);

    if (mode === 'daily') this._restoreDailyProgress();

    this.render();
    this.ui.renderEntropy(this.candidates.length, this.candidates.length, this.initialCount);
    if (this.status !== 'playing') this._showEndState(false);
  }

  // Replay any saved Daily guesses so a refresh resumes the same board.
  _restoreDailyProgress() {
    const dailyObj = this.isEquation ? this.eqDaily : this.daily;
    const saved = dailyObj.loadProgress(this.dailyDate);
    if (!saved || !saved.guesses) return;
    for (const g of saved.guesses) {
      if (this.isEquation) {
        this._applyGuessEq(g.a, g.op, g.b, evaluateEquation(g.a, g.op, g.b), false);
      } else {
        this._applyGuess(g.a, g.op, g.b, false);
      }
    }
    this.status = saved.status || this.status;
  }

  // Rebuild the possibility space from scratch and re-apply every guess — used
  // when the hints setting changes mid-game (it alters the feedback channel).
  _recomputeCandidates() {
    const eq = this.isEquation;
    const engine = eq ? this.eqEngine : this.entropy;
    const fbEngine = eq ? this.eqFeedback : this.feedback;
    let cands = eq ? this.eqEngine.universe().slice() : this.entropy.buildCandidates(this.puzzle.result);
    for (const g of this.guesses) {
      const guess = { a: g.a, op: g.op, b: g.b, c: g.c };
      const sig = this.hints ? fbEngine.signature(g.fb) : fbEngine.signatureNoHints(g.fb);
      cands = engine.filter(cands, guess, sig, this.hints);
    }
    this.candidates = cands;
  }

  // ---- Input handling ----------------------------------------------------

  handleKey(key) {
    if (this.status !== 'playing') return;

    if (this.isEquation) {
      if (key === 'enter') return this._eqSubmit();
      if (key === 'del') return this._eqDelete();
      if (key === '=') return this._eqEquals();
      if (/^[0-9]$/.test(key)) return this._eqAddDigit(key);
      if (OPS.includes(key)) return this._eqSetOperator(key);
      return;
    }

    if (key === 'enter') return this.submit();
    if (key === 'del') return this._delete();
    if (/^[0-9]$/.test(key)) return this._addDigit(key);
    if (OPS.includes(key)) return this._setOperator(key);
  }

  // ---- Equation input ----------------------------------------------------
  // Fields fill in order: first operand → operator → second operand → (=) →
  // result → Enter. `phase` tracks which field is active.

  _eqAddDigit(d) {
    const I = this.eqInput;
    if (I.phase === 'a' && I.first.length < 2) I.first += d;
    else if (I.phase === 'b' && I.second.length < 2) I.second += d;
    else if (I.phase === 'c' && I.result.length < 4) I.result += d;
    this.render();
  }

  _eqSetOperator(op) {
    const I = this.eqInput;
    if (I.phase === 'a' && I.first.length >= 1) {
      I.op = op;
      I.phase = 'b';
      this.render();
    }
  }

  _eqEquals() {
    const I = this.eqInput;
    if (I.phase === 'b' && I.second.length >= 1) {
      I.phase = 'c';
      this.render();
    }
  }

  _eqDelete() {
    const I = this.eqInput;
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

  _eqSubmit() {
    const I = this.eqInput;
    const check = this.eqValidator.validate(I.first, I.op, I.second, I.result);
    if (!check.ok) {
      this.ui.showToast(check.message);
      this.ui.shakeCurrentRow();
      return;
    }
    this.eqInput = { first: '', op: null, second: '', result: '', phase: 'a' };
    this._applyGuessEq(check.a, check.op, check.b, check.c, true);

    if (this.mode === 'daily') {
      this.eqDaily.saveProgress(this.dailyDate, {
        guesses: this.guesses.map((g) => ({ a: g.a, op: g.op, b: g.b })),
        status: this.status,
      });
    }
  }

  _applyGuessEq(a, op, b, c, animate) {
    const guess = { a, op, b, c };
    const fb = this.eqFeedback.grade(guess, this.puzzle);
    this.guesses.push({ a, op, b, c, fb });

    const before = this.candidates.length;
    const sig = this.hints ? this.eqFeedback.signature(fb) : this.eqFeedback.signatureNoHints(fb);
    this.candidates = this.eqEngine.filter(this.candidates, guess, sig, this.hints);

    this.justSubmitted = animate;
    if (this.eqFeedback.isWin(fb)) this.status = 'won';
    else if (this.guesses.length >= this.maxGuesses) this.status = 'lost';

    this.render();
    if (animate) {
      this.ui.renderEntropy(before, this.candidates.length, this.initialCount);
      if (this.status !== 'playing') {
        this._recordOnce();
        setTimeout(() => this._showEndState(true), 1100);
      }
    }
    this.prevCount = this.candidates.length;
    this.justSubmitted = false;
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
    const sig = this.hints ? this.feedback.signature(fb) : this.feedback.signatureNoHints(fb);
    this.candidates = this.entropy.filter(this.candidates, guess, sig, this.hints);

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
    // Both puzzle shapes expose `.result`, so the same solution view works.
    this.ui.showGameOver({
      won: this.status === 'won',
      solution: this.puzzle,
      guessesUsed: this.guesses.length,
      maxGuesses: this.maxGuesses,
    });
  }

  // ---- Sharing -----------------------------------------------------------

  shareText() {
    const name = this.isEquation ? 'Mathle Equation' : 'Mathle';
    const head =
      this.mode === 'daily' ? `${name} #${this.dailyNumber}` : `${name} Unlimited`;
    const score = this.status === 'won' ? this.guesses.length : 'X';
    const sq = { correct: '🟩', present: '🟨', absent: '⬜' };
    const opSq = (s) => (s === 'correct' ? '🟩' : '⬜');
    const lines = this.guesses.map((g) => {
      const first = g.fb.first.map((s) => sq[s]).join('');
      const second = g.fb.second.map((s) => sq[s]).join('');
      if (this.isEquation) {
        const result = g.fb.result.map((s) => sq[s]).join('');
        return `${first}${opSq(g.fb.operator)}${second}${result}`;
      }
      return `${first}${opSq(g.fb.operator)}${second}`;
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
      else if (k === '=') { this.handleKey('='); }
    });
  }

  _bindGlobalControls() {
    const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);

    on('mode-toggle', () => this.newGame(this.mode === 'daily' ? 'unlimited' : 'daily'));
    on('type-toggle', () => {
      this.gameType = this.isEquation ? 'classic' : 'equation';
      this._recorded = false;
      this.newGame(this.mode);
    });
    on('hints-toggle', () => this._toggleHints());
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
      // Daily can't be replayed; always offer a fresh Unlimited puzzle.
      this.newGame('unlimited');
    });
  }

  _toggleHints() {
    this.hints = !this.hints;
    try {
      localStorage.setItem('mathle-hints', this.hints ? '1' : '0');
    } catch { /* ignore */ }
    document.body.classList.toggle('hints-off', !this.hints);
    // Re-derive the possibility space for the new feedback channel, then redraw.
    const before = this.candidates.length;
    this._recomputeCandidates();
    this.render();
    this.ui.renderEntropy(before, this.candidates.length, this.initialCount);
    this.prevCount = this.candidates.length;
    this.ui.showToast(this.hints ? 'Higher/Lower hints on' : 'Hints off (harder)');
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

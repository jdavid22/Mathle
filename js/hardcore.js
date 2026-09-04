/**
 * Hardcore controller (/hardcore).
 *
 * The daily equation against a 60-second clock. One attempt per day:
 *  - The timer starts on the first keystroke and is wall-clock based, so a
 *    refresh resumes with the correct time left (it can't be reset).
 *  - Six guesses, same green/yellow/grey feedback as the main game.
 *  - Every WRONG calculation counts as a guess: a non-balancing equation (e.g.
 *    10 x 12 = 119) is recorded as a red, un-graded row instead of a free reject.
 *  - Under 10s left, the screen edge flashes red.
 *
 * Reuses the pure modules and UIRenderer; the main game is untouched.
 */
class HardcoreGame {
  constructor() {
    this.feedback = new EquationFeedback();
    this.generator = new EquationGenerator();
    // Same salt as the normal daily => the same hidden equation, but its own
    // saved-progress key so the two modes don't clash.
    this.daily = new DailyPuzzle(this.generator, 'mathle-hardcore-eq', 'eq');
    this.ui = new UIRenderer();

    this.maxGuesses = 6;
    this.timeLimit = 60; // seconds
    this.dom = {
      timer: document.getElementById('hc-timer'),
      timerBar: document.getElementById('hc-timer-bar'),
    };

    this._applyTheme();

    const info = this.daily.generateForToday();
    this.puzzle = info.puzzle;
    this.dailyDate = info.date;
    this.dailyNumber = info.number;

    this.input = { first: '', op: null, second: '', result: '', phase: 'a' };
    this.guesses = [];
    this.status = 'idle'; // idle -> playing -> won | lost
    this.startedAt = null;
    this.endReason = null; // 'time' | 'guesses'
    this.justSubmitted = false;

    this._bindInput();
    this._bindControls();
    this._restore();

    this.render();
    this._renderTimer();

    if (this.status === 'playing') {
      this._startTicking();
    } else if (this.status === 'won' || this.status === 'lost') {
      this._showEndState();
    } else if (localStorage.getItem('mathle-hardcore-help-hidden') !== '1') {
      this.ui.openModal('help-modal');
    }
    requestAnimationFrame(() => this.ui._fitBoard());
    window.addEventListener('resize', () => this.ui._fitBoard());
  }

  // Match the main game's seasonal palette (no keypress ghost here — it's timed).
  _applyTheme() {
    const param = new URLSearchParams(location.search).get('theme');
    let on;
    if (param === 'halloween') on = true;
    else if (param === 'off') on = false;
    else {
      const d = new Date();
      on = d.getMonth() === 9 && d.getDate() >= 26 && d.getDate() <= 31;
    }
    document.body.classList.toggle('halloween', on);
  }

  // ---- Persistence (single attempt per day) ------------------------------

  _restore() {
    const saved = this.daily.loadProgress(this.dailyDate);
    if (!saved) return;
    this.startedAt = saved.startedAt || null;
    this.endReason = saved.endReason || null;
    (saved.guesses || []).forEach((g) => {
      if (g.invalid) {
        this.guesses.push({ a: g.a, op: g.op, b: g.b, c: g.c, invalid: true });
      } else {
        const guess = { a: g.a, op: g.op, b: g.b, c: g.c };
        this.guesses.push({ ...guess, fb: this.feedback.grade(guess, this.puzzle) });
      }
    });
    this.status = saved.status || 'idle';
    // Started but the clock has since run out -> it's a loss.
    if (this.status === 'playing' && this.startedAt && this._remainingMs() <= 0) {
      this.status = 'lost';
      this.endReason = 'time';
      this._persist();
    }
  }

  _persist() {
    this.daily.saveProgress(this.dailyDate, {
      startedAt: this.startedAt,
      status: this.status,
      endReason: this.endReason,
      guesses: this.guesses.map((g) => ({ a: g.a, op: g.op, b: g.b, c: g.c, invalid: !!g.invalid })),
    });
  }

  // ---- Timer -------------------------------------------------------------

  _remainingMs() {
    if (!this.startedAt) return this.timeLimit * 1000;
    return Math.max(0, this.timeLimit * 1000 - (Date.now() - this.startedAt));
  }

  _startTicking() {
    this._stopTicking();
    this._tick();
    this._timer = setInterval(() => this._tick(), 250);
  }

  _stopTicking() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _tick() {
    const ms = this._remainingMs();
    this._renderTimer(ms);
    if (ms <= 0 && this.status === 'playing') {
      this.status = 'lost';
      this.endReason = 'time';
      this._finish();
    }
  }

  _renderTimer(ms) {
    if (ms == null) ms = this._remainingMs();
    const secs = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    this.dom.timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
    this.dom.timerBar.style.width = Math.max(0, (ms / (this.timeLimit * 1000)) * 100) + '%';

    const urgent = this.status === 'playing' && ms > 0 && ms <= 10000;
    this.dom.timer.classList.toggle('urgent', urgent);
    this.dom.timerBar.classList.toggle('urgent', urgent);
    document.body.classList.toggle('hc-urgent', urgent);
  }

  // ---- Input (mirrors the main game) -------------------------------------

  _start() {
    this.status = 'playing';
    this.startedAt = Date.now();
    this._persist();
    this._startTicking();
  }

  handleKey(key) {
    if (this.status === 'won' || this.status === 'lost') return; // locked for the day
    if (key === 'enter') return this.submit();
    if (key === 'del') return this._delete();
    if (key === '=') return this._equals();
    if (/^[0-9]$/.test(key)) return this._addDigit(key);
    if (OPS.includes(key)) return this._setOperator(key);
  }

  _appendDigit(current, d, maxLen) {
    if (current.length >= maxLen) return current;
    return (current + d).replace(/^0+(?=\d)/, ''); // leading zero -> blank
  }

  _addDigit(d) {
    if (this.status === 'idle') this._start(); // first keystroke starts the clock
    const I = this.input;
    if (I.phase === 'a') {
      I.first = this._appendDigit(I.first, d, 2);
    } else if (I.phase === 'b') {
      I.second = this._appendDigit(I.second, d, 2);
      if (I.second.length === 2) I.phase = 'c';
    } else if (I.phase === 'c') {
      I.result = this._appendDigit(I.result, d, 4);
    }
    this.render();
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
    if (!I.first || !I.op || !I.second || !I.result) {
      this.ui.showToast('Fill in the whole equation.');
      this.ui.shakeCurrentRow();
      return;
    }
    const a = parseInt(I.first, 10);
    const b = parseInt(I.second, 10);
    const c = parseInt(I.result, 10);
    const op = I.op;
    if (a < 1 || a > 99 || b < 1 || b > 99) {
      this.ui.showToast('Numbers must be 1–99.');
      this.ui.shakeCurrentRow();
      return;
    }

    if (this.status === 'idle') this._start();
    this.input = { first: '', op: null, second: '', result: '', phase: 'a' };

    // Any complete equation now spends a guess. Balanced -> graded; otherwise
    // it's a wrong calculation: recorded as a red row, no hints.
    if (evaluateEquation(a, op, b) === c) {
      const fb = this.feedback.grade({ a, op, b, c }, this.puzzle);
      this.guesses.push({ a, op, b, c, fb });
      if (this.feedback.isWin(fb)) this.status = 'won';
    } else {
      this.guesses.push({ a, op, b, c, invalid: true });
    }
    if (this.status !== 'won' && this.guesses.length >= this.maxGuesses) {
      this.status = 'lost';
      this.endReason = 'guesses';
    }

    this.justSubmitted = true;
    this.render();
    this.justSubmitted = false;
    this._persist();
    if (this.status !== 'playing') this._finish();
  }

  // ---- End state ---------------------------------------------------------

  _finish() {
    this._stopTicking();
    document.body.classList.remove('hc-urgent');
    this._renderTimer(this._remainingMs());
    this._persist();
    this._showEndState();
  }

  _showEndState() {
    const el = (id) => document.getElementById(id);
    const won = this.status === 'won';
    el('hc-over-title').textContent = won
      ? 'Solved!'
      : this.endReason === 'time'
      ? "Time's up"
      : 'Out of guesses';
    const usedSecs = this.startedAt
      ? Math.min(this.timeLimit, Math.round((Date.now() - this.startedAt) / 1000))
      : 0;
    el('hc-over-sub').textContent = won
      ? `Cracked it in ${this.guesses.length}/${this.maxGuesses}, ${usedSecs}s.`
      : 'The daily hardcore is one shot. Come back tomorrow.';
    el('hc-over-eq').textContent =
      `${this.puzzle.a} ${this.puzzle.op} ${this.puzzle.b} = ${formatNumber(this.puzzle.result)}`;
    this.ui.openModal('gameover-modal');
  }

  // ---- Sharing -----------------------------------------------------------

  shareText() {
    const score = this.status === 'won' ? this.guesses.length : 'X';
    const sq = { correct: '🟩', present: '🟨', absent: '⬜' };
    const opSq = (s) => (s === 'correct' ? '🟩' : '⬜');
    const lines = this.guesses.map((g) => {
      if (g.invalid) return '🟥🟥🟥🟥🟥🟥🟥🟥🟥';
      const first = g.fb.first.map((s) => sq[s]).join('');
      const second = g.fb.second.map((s) => sq[s]).join('');
      const result = g.fb.result.map((s) => sq[s]).join('');
      return `${first}${opSq(g.fb.operator)}${second}${result}`;
    });
    const url = `${location.origin}${location.pathname}`;
    return `Mathle Hardcore #${this.dailyNumber} ${score}/6 ⏱️\n\n${lines.join('\n')}\n\n${url}`;
  }

  async copyShare() {
    try {
      await navigator.clipboard.writeText(this.shareText());
      this.ui.showToast('Results copied!');
    } catch {
      this.ui.showToast('Copy failed');
    }
  }

  // ---- Rendering & wiring ------------------------------------------------

  render() {
    this.ui.renderBoard(this);
    this.ui.updateKeyboard(this);
  }

  _bindInput() {
    this.ui.dom.keypad.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-key]');
      if (btn) this.handleKey(btn.dataset.key);
    });
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

  _bindControls() {
    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    on('help-btn', () => this.ui.openModal('help-modal'));
    on('colorblind-btn', () => this._toggleColorblind());
    on('overlay', () => this.ui.closeModals());
    on('hc-share', () => this.copyShare());
    document.querySelectorAll('[data-close]').forEach((el) =>
      el.addEventListener('click', () => this.ui.closeModals())
    );

    const dismiss = document.getElementById('help-dismiss');
    if (dismiss) {
      dismiss.checked = localStorage.getItem('mathle-hardcore-help-hidden') === '1';
      dismiss.addEventListener('change', () => {
        try {
          localStorage.setItem('mathle-hardcore-help-hidden', dismiss.checked ? '1' : '0');
        } catch { /* ignore */ }
      });
    }
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

window.addEventListener('DOMContentLoaded', () => {
  window.hardcore = new HardcoreGame();
});

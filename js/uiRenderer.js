/**
 * UI Renderer.
 *
 * Owns every DOM read/write. It never mutates game state — the controller
 * (Game) hands it state and the renderer reflects it: the board of tiles, the
 * live possibility meter, the on-screen keypad colouring, toasts and modals.
 */
class UIRenderer {
  constructor() {
    this.dom = {
      target: document.getElementById('target-result'),
      board: document.getElementById('board'),
      entropyValue: document.getElementById('entropy-value'),
      entropyBar: document.getElementById('entropy-bar'),
      keypad: document.getElementById('keypad'),
      toast: document.getElementById('toast'),
      modeLabel: document.getElementById('mode-label'),
      puzzleTag: document.getElementById('puzzle-tag'),
    };
    this._entropyAnim = null;
  }

  renderTarget(result) {
    this.dom.target.textContent = formatNumber(result);
  }

  renderModeBadge(mode, dailyNumber) {
    this.dom.modeLabel.textContent = mode === 'daily' ? 'Daily' : 'Unlimited';
    this.dom.puzzleTag.textContent =
      mode === 'daily' && dailyNumber ? `#${dailyNumber}` : '∞';
  }

  // ---- Board -------------------------------------------------------------

  _makeTile(char, state, isOp) {
    const tile = document.createElement('div');
    tile.className = 'tile' + (isOp ? ' op' : '') + (state ? ' ' + state : '');
    tile.textContent = char;
    return tile;
  }

  // A full-width pill that annotates the WHOLE operand's value (not a digit):
  // "▲ Higher" / "▼ Lower" tells the player which way the hidden number lies.
  _hintChip(hint) {
    const chip = document.createElement('div');
    chip.className = 'hint ' + hint;
    if (hint === 'equal') {
      chip.innerHTML = '<span class="hint-ico">✓</span><span class="hint-word">Match</span>';
    } else {
      const ico = hint === 'up' ? '▲' : '▼';
      const word = hint === 'up' ? 'Higher' : 'Lower';
      chip.innerHTML = `<span class="hint-ico">${ico}</span><span class="hint-word">${word}</span>`;
    }
    return chip;
  }

  // Build one operand group (3 tiles + optional full-width value hint beneath).
  _operandGroup(chars, states, hint, reveal) {
    const wrap = document.createElement('div');
    wrap.className = 'operand-wrap';
    const group = document.createElement('div');
    group.className = 'operand';
    for (let i = 0; i < 3; i++) {
      const tile = this._makeTile(chars[i] ?? '', states ? states[i] : (chars[i] ? 'filled' : ''), false);
      if (reveal) {
        tile.classList.add('reveal');
        tile.style.animationDelay = `${i * 90}ms`;
      }
      group.appendChild(tile);
    }
    wrap.appendChild(group);
    if (hint) wrap.appendChild(this._hintChip(hint));
    return wrap;
  }

  // Render the full 6-row board from game state.
  renderBoard(game) {
    const board = this.dom.board;
    board.innerHTML = '';

    for (let row = 0; row < game.maxGuesses; row++) {
      const rowEl = document.createElement('div');
      rowEl.className = 'row';
      // The tiles live on their own line so a row is never wider than 7 tiles;
      // hints and the result caption stack beneath it (mobile-friendly).
      const eq = document.createElement('div');
      eq.className = 'row-eq';

      const guess = game.guesses[row];
      const isCurrent = row === game.guesses.length && game.status === 'playing';

      if (guess) {
        // Completed, graded guess.
        const justRevealed = row === game.guesses.length - 1 && game.justSubmitted;
        eq.appendChild(
          this._operandGroup(digits3(guess.a), guess.fb.first, guess.fb.firstHint, justRevealed)
        );
        eq.appendChild(this._makeTile(guess.op, guess.fb.operator, true));
        eq.appendChild(
          this._operandGroup(digits3(guess.b), guess.fb.second, guess.fb.secondHint, justRevealed)
        );
        rowEl.appendChild(eq);
        rowEl.appendChild(this._resultLabel(guess.result, game.puzzle.result));
        if (justRevealed && game.status === 'won') rowEl.classList.add('win-bounce');
      } else if (isCurrent) {
        // Live input row.
        const first = game.input.first.split('');
        const second = game.input.second.split('');
        eq.appendChild(this._operandGroup(first, null, null, false));
        eq.appendChild(this._makeTile(game.input.op || '', game.input.op ? 'filled' : '', true));
        eq.appendChild(this._operandGroup(second, null, null, false));
        rowEl.appendChild(eq);
        rowEl.classList.add('current');
        this._currentRowEl = rowEl;
      } else {
        // Empty future row.
        eq.appendChild(this._operandGroup([], null, null, false));
        eq.appendChild(this._makeTile('', '', true));
        eq.appendChild(this._operandGroup([], null, null, false));
        rowEl.appendChild(eq);
      }
      board.appendChild(rowEl);
    }
  }

  _resultLabel(result, target) {
    const span = document.createElement('div');
    span.className = 'eq-result' + (result === target ? ' match' : '');
    span.textContent = '= ' + formatNumber(result);
    return span;
  }

  // ---- Entropy meter -----------------------------------------------------

  renderEntropy(from, to, initial) {
    this._animateNumber(this.dom.entropyValue, from, to);
    // Log scale so a drop from thousands to dozens is visible.
    const pct = initial > 1 ? (Math.log2(to + 1) / Math.log2(initial + 1)) * 100 : 100;
    this.dom.entropyBar.style.width = Math.max(4, pct) + '%';
    this.dom.entropyBar.classList.toggle('solved', to <= 1);
  }

  _animateNumber(el, from, to) {
    if (this._entropyAnim) cancelAnimationFrame(this._entropyAnim);
    const duration = 600;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const val = Math.round(from + (to - from) * eased);
      el.textContent = formatNumber(val);
      if (t < 1) this._entropyAnim = requestAnimationFrame(tick);
    };
    this._entropyAnim = requestAnimationFrame(tick);
  }

  // ---- Keypad ------------------------------------------------------------

  // Colour each key by the best status that digit/operator has achieved.
  updateKeyboard(game) {
    const rank = { correct: 3, present: 2, absent: 1, '': 0 };
    const best = {};
    const consider = (key, state) => {
      if ((rank[state] || 0) > (rank[best[key]] || 0)) best[key] = state;
    };
    for (const g of game.guesses) {
      digits3(g.a).forEach((d, i) => consider(d, g.fb.first[i]));
      digits3(g.b).forEach((d, i) => consider(d, g.fb.second[i]));
      consider(g.op, g.fb.operator);
    }
    this.dom.keypad.querySelectorAll('button[data-key]').forEach((btn) => {
      const key = btn.dataset.key;
      btn.classList.remove('correct', 'present', 'absent');
      if (best[key]) btn.classList.add(best[key]);
    });
  }

  // ---- Transient feedback ------------------------------------------------

  showToast(message) {
    const t = this.dom.toast;
    t.textContent = message;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
  }

  shakeCurrentRow() {
    if (!this._currentRowEl) return;
    this._currentRowEl.classList.remove('shake');
    // Force reflow so the animation can retrigger.
    void this._currentRowEl.offsetWidth;
    this._currentRowEl.classList.add('shake');
  }

  // ---- Modals ------------------------------------------------------------

  openModal(id) {
    document.getElementById(id).classList.add('open');
    document.getElementById('overlay').classList.add('open');
  }

  closeModals() {
    document.querySelectorAll('.modal').forEach((m) => m.classList.remove('open'));
    document.getElementById('overlay').classList.remove('open');
  }

  renderStats(stats, statsMgr) {
    document.getElementById('stat-played').textContent = stats.played;
    document.getElementById('stat-winpct').textContent = statsMgr.winPct();
    document.getElementById('stat-streak').textContent = stats.currentStreak;
    document.getElementById('stat-best').textContent = stats.bestStreak;

    const maxDist = Math.max(1, ...stats.dist);
    const container = document.getElementById('dist-bars');
    container.innerHTML = '';
    stats.dist.forEach((count, i) => {
      const row = document.createElement('div');
      row.className = 'dist-row';
      const label = document.createElement('span');
      label.className = 'dist-label';
      label.textContent = i + 1;
      const bar = document.createElement('div');
      bar.className = 'dist-bar';
      bar.style.width = (count / maxDist) * 100 + '%';
      bar.textContent = count;
      row.appendChild(label);
      row.appendChild(bar);
      container.appendChild(row);
    });
  }

  showGameOver({ won, solution, guessesUsed, maxGuesses }) {
    document.getElementById('gameover-title').textContent = won ? 'Solved!' : 'Out of guesses';
    document.getElementById('gameover-sub').textContent = won
      ? `You cracked it in ${guessesUsed}/${maxGuesses}.`
      : 'Better luck next time.';
    document.getElementById('result-equation').textContent =
      `${solution.a} ${solution.op} ${solution.b} = ${formatNumber(solution.result)}`;
    this.openModal('gameover-modal');
  }
}

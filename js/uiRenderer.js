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

  // A static, ungraded "=" separator between the second operand and the result.
  _separator() {
    const t = document.createElement('div');
    t.className = 'tile sep';
    t.textContent = '=';
    return t;
  }

  // A graded field: cells (with BLANK tokens) + per-cell colour + optional hint.
  _field(cells, states, hint, reveal) {
    const wrap = document.createElement('div');
    wrap.className = 'operand-wrap';
    const group = document.createElement('div');
    group.className = 'operand';
    for (let i = 0; i < cells.length; i++) {
      const isBlank = cells[i] === BLANK;
      const tile = this._makeTile(isBlank ? '' : cells[i], states ? states[i] : '', false);
      if (isBlank) tile.classList.add('blank');
      if (reveal) {
        tile.classList.add('reveal');
        tile.style.animationDelay = `${i * 80}ms`;
      }
      group.appendChild(tile);
    }
    wrap.appendChild(group);
    if (hint) wrap.appendChild(this._hintChip(hint));
    return wrap;
  }

  // A live input field: typed digits right-aligned, remaining cells empty. The
  // active field is outlined so the player can see where input is going.
  _inputField(value, width, active) {
    const wrap = document.createElement('div');
    wrap.className = 'operand-wrap';
    const group = document.createElement('div');
    group.className = 'operand' + (active ? ' active' : '');
    const chars = value.split('');
    const pad = width - chars.length;
    for (let i = 0; i < width; i++) {
      const ch = i >= pad ? chars[i - pad] : '';
      group.appendChild(this._makeTile(ch, ch ? 'filled' : '', false));
    }
    wrap.appendChild(group);
    return wrap;
  }

  // Swap freshly-built rows into the board region and rescale to fit.
  _mountRows(rowsEl) {
    this.dom.board.innerHTML = '';
    this.dom.board.appendChild(rowsEl);
    this._boardRows = rowsEl;
    this._fitBoard();
  }

  // Scale the rows down if (and only if) they'd overflow the board region, so
  // the whole game always fits one non-scrolling screen. offsetHeight is the
  // pre-transform layout height, so this is idempotent.
  _fitBoard() {
    const rows = this._boardRows;
    if (!rows) return;
    const avail = this.dom.board.clientHeight;
    const natural = rows.offsetHeight;
    const scale = natural > avail && natural > 0 ? avail / natural : 1;
    rows.style.transform = scale < 1 ? `scale(${scale})` : '';
  }

  // Render the full 6-row board: [a a][op][b b][=][c c c c] per row.
  renderBoard(game) {
    const board = document.createElement('div');
    board.className = 'board-rows';

    for (let row = 0; row < game.maxGuesses; row++) {
      const rowEl = document.createElement('div');
      rowEl.className = 'row';
      const eq = document.createElement('div');
      eq.className = 'row-eq';

      const guess = game.guesses[row];
      const isCurrent = row === game.guesses.length && game.status === 'playing';

      if (guess) {
        const justRevealed = row === game.guesses.length - 1 && game.justSubmitted;
        eq.appendChild(this._field(padCells(guess.a, 2), guess.fb.first, guess.fb.firstHint, justRevealed));
        eq.appendChild(this._makeTile(guess.op, guess.fb.operator, true));
        eq.appendChild(this._field(padCells(guess.b, 2), guess.fb.second, guess.fb.secondHint, justRevealed));
        eq.appendChild(this._separator());
        eq.appendChild(this._field(padCells(guess.c, 4), guess.fb.result, null, justRevealed));
        rowEl.appendChild(eq);
        if (justRevealed && game.status === 'won') rowEl.classList.add('win-bounce');
      } else if (isCurrent) {
        const I = game.input;
        eq.appendChild(this._inputField(I.first, 2, I.phase === 'a'));
        eq.appendChild(this._makeTile(I.op || '', I.op ? 'filled' : '', true));
        eq.appendChild(this._inputField(I.second, 2, I.phase === 'b'));
        eq.appendChild(this._separator());
        eq.appendChild(this._inputField(I.result, 4, I.phase === 'c'));
        rowEl.appendChild(eq);
        rowEl.classList.add('current');
        this._currentRowEl = rowEl;
      } else {
        eq.appendChild(this._inputField('', 2, false));
        eq.appendChild(this._makeTile('', '', true));
        eq.appendChild(this._inputField('', 2, false));
        eq.appendChild(this._separator());
        eq.appendChild(this._inputField('', 4, false));
        rowEl.appendChild(eq);
      }
      board.appendChild(rowEl);
    }
    this._mountRows(board);
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

  // Colour each key with the conventional keyboard meaning:
  //   green  = you've placed this digit correctly somewhere
  //   yellow = this digit is in the hidden answer, but not yet placed
  //   grey   = this digit is NOT in the answer anywhere
  //
  // Tiles are graded per field (per operand / the result), so a digit can be
  // grey on a tile yet still live in another field. The keyboard therefore can't
  // just echo the best tile colour — that would grey out digits that are really
  // in the answer. Instead we judge membership against the whole hidden answer,
  // and only colour digits the player has actually tried.
  updateKeyboard(game) {
    const guessed = new Set(); // digits the player has entered
    const greens = new Set();  // digits placed correctly in some field
    const opState = {};        // operator key -> 'correct' | 'absent'

    const scan = (cells, states) => {
      cells.forEach((d, i) => {
        if (d === BLANK) return;
        guessed.add(d);
        if (states[i] === 'correct') greens.add(d);
      });
    };
    for (const g of game.guesses) {
      scan(padCells(g.a, 2), g.fb.first);
      scan(padCells(g.b, 2), g.fb.second);
      scan(padCells(g.c, 4), g.fb.result);
      if (g.fb.operator === 'correct') opState[g.op] = 'correct';
      else if (!opState[g.op]) opState[g.op] = 'absent';
    }

    // Every digit that appears anywhere in the hidden answer.
    const answerDigits = new Set();
    for (const n of [game.puzzle.a, game.puzzle.b, game.puzzle.c]) {
      for (const ch of String(n)) answerDigits.add(ch);
    }

    this.dom.keypad.querySelectorAll('button[data-key]').forEach((btn) => {
      const key = btn.dataset.key;
      btn.classList.remove('correct', 'present', 'absent');
      if (/^[0-9]$/.test(key)) {
        if (!guessed.has(key)) return; // only colour digits actually tried
        btn.classList.add(
          greens.has(key) ? 'correct' : answerDigits.has(key) ? 'present' : 'absent'
        );
      } else if (opState[key]) {
        btn.classList.add(opState[key]);
      }
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
    document.getElementById('stat-miscalc').textContent = stats.miscalcs || 0;

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

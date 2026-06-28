/**
 * Daily Puzzle Generator.
 *
 * Derives a deterministic seed from the local calendar date so every player
 * gets the same puzzle on the same day, assigns a stable "day number", and
 * persists in-progress / finished Daily games so a refresh resumes where the
 * player left off (and a finished Daily can't be replayed).
 */
class DailyPuzzle {
  constructor(generator, storageKey = 'mathle-daily', salt = '') {
    this.generator = generator;
    this.key = storageKey;
    this.salt = salt; // distinguishes seeds across game types on the same date
  }

  // Local YYYY-MM-DD for a given date (defaults to today).
  todayString(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // FNV-1a hash of the date string -> 32-bit seed.
  _seedFromDate(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Sequential puzzle number counting from the launch epoch.
  dayNumber(str) {
    const [y, m, d] = str.split('-').map(Number);
    const epoch = Date.UTC(2024, 0, 1);
    const today = Date.UTC(y, m - 1, d);
    return Math.floor((today - epoch) / 86400000) + 1;
  }

  // Build today's deterministic puzzle plus its metadata.
  generateForToday() {
    const date = this.todayString();
    const rng = new SeededRandom(this._seedFromDate(date + this.salt));
    return {
      puzzle: this.generator.generate(rng),
      date,
      number: this.dayNumber(date),
    };
  }

  // Persist progress for the current day. `state` is { guesses, status }.
  saveProgress(date, state) {
    try {
      localStorage.setItem(this.key, JSON.stringify({ date, ...state }));
    } catch {
      /* ignore storage errors */
    }
  }

  // Load saved progress only if it belongs to `date`; otherwise null.
  loadProgress(date) {
    try {
      const raw = JSON.parse(localStorage.getItem(this.key));
      if (raw && raw.date === date) return raw;
    } catch {
      /* ignore */
    }
    return null;
  }
}

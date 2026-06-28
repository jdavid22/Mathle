/**
 * Statistics Manager.
 *
 * Persists lifetime play stats in localStorage and exposes derived values
 * (win %, streaks, guess distribution) for the stats modal.
 */
class StatisticsManager {
  constructor(storageKey = 'mathle-stats') {
    this.key = storageKey;
    this.stats = this._load();
  }

  _empty() {
    return {
      played: 0,
      wins: 0,
      currentStreak: 0,
      bestStreak: 0,
      dist: [0, 0, 0, 0, 0, 0], // index i = games won in (i+1) guesses
      miscalcs: 0, // Equation mode: guesses rejected for not balancing
    };
  }

  _load() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.key));
      if (!raw) return this._empty();
      // Merge with defaults so older/partial records stay valid.
      return { ...this._empty(), ...raw, dist: raw.dist || this._empty().dist };
    } catch {
      return this._empty();
    }
  }

  _save() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.stats));
    } catch {
      /* storage unavailable (private mode) — stats simply won't persist */
    }
  }

  // Record a finished game. `guesses` is the number used when won.
  record(won, guesses) {
    this.stats.played++;
    if (won) {
      this.stats.wins++;
      this.stats.currentStreak++;
      this.stats.bestStreak = Math.max(this.stats.bestStreak, this.stats.currentStreak);
      if (guesses >= 1 && guesses <= 6) this.stats.dist[guesses - 1]++;
    } else {
      this.stats.currentStreak = 0;
    }
    this._save();
  }

  // Equation mode: the player typed an answer that doesn't match their own
  // operands (e.g. 10 × 11 = 119). Recorded even though the guess is rejected.
  recordMiscalc() {
    this.stats.miscalcs = (this.stats.miscalcs || 0) + 1;
    this._save();
  }

  winPct() {
    return this.stats.played ? Math.round((this.stats.wins / this.stats.played) * 100) : 0;
  }
}

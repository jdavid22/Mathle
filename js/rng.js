/**
 * Random sources.
 *
 * `SeededRandom` is a deterministic PRNG (mulberry32) used by Daily mode so
 * every player gets an identical puzzle for a given date. `LiveRandom` wraps
 * Math.random for Unlimited mode. Both expose the same {int, pick} interface so
 * the puzzle generator is agnostic to which one it receives.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class SeededRandom {
  constructor(seed) {
    this._next = mulberry32(seed);
  }
  // Float in [0, 1).
  float() {
    return this._next();
  }
  // Integer in [min, max] inclusive.
  int(min, max) {
    return Math.floor(this._next() * (max - min + 1)) + min;
  }
  // Uniformly pick an element of an array.
  pick(arr) {
    return arr[this.int(0, arr.length - 1)];
  }
}

class LiveRandom {
  float() {
    return Math.random();
  }
  int(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  pick(arr) {
    return arr[this.int(0, arr.length - 1)];
  }
}

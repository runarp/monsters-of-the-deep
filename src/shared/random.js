export function createRng(seed = Date.now()) {
  let state = hashSeed(seed);

  return {
    next() {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    float(min = 0, max = 1) {
      return min + (max - min) * this.next();
    },
    int(min, max) {
      return Math.floor(this.float(min, max + 1));
    },
    chance(probability) {
      return this.next() < probability;
    },
    pick(values) {
      return values[Math.floor(this.next() * values.length)];
    }
  };
}

function hashSeed(seed) {
  const input = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

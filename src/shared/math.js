export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function normalize(x, y) {
  const length = Math.hypot(x, y);
  if (length <= 0.0001) {
    return { x: 0, y: 0, length: 0 };
  }
  return { x: x / length, y: y / length, length };
}

export function angleLerp(from, to, amount) {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + difference * amount;
}

export function keepInsideCircle(entity, radius) {
  const distance = Math.hypot(entity.x, entity.y);
  if (distance <= radius) {
    return;
  }

  const normalX = entity.x / distance;
  const normalY = entity.y / distance;
  entity.x = normalX * radius;
  entity.y = normalY * radius;

  const outwardVelocity = entity.vx * normalX + entity.vy * normalY;
  if (outwardVelocity > 0) {
    entity.vx -= outwardVelocity * normalX * 1.7;
    entity.vy -= outwardVelocity * normalY * 1.7;
  }
}

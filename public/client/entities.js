import { calculateInput } from "./input.js";
import { recordSighting } from "./speciesLog.js";
import { netDebug, state } from "./state.js";
import { clamp, clamp01, lerpAngle } from "./util.js";

export function ingestSnapshot(snapshot) {
  const seenAt = performance.now();
  if (netDebug.lastSnapshotAt > 0) {
    netDebug.intervals.push(seenAt - netDebug.lastSnapshotAt);
    if (netDebug.intervals.length > 48) {
      netDebug.intervals.shift();
    }
  }
  netDebug.lastSnapshotAt = seenAt;
  netDebug.snapshotCount += 1;

  const entities = [
    ...snapshot.players,
    ...snapshot.npcs,
    ...snapshot.food,
    ...snapshot.addons,
    ...(snapshot.hazards ?? [])
  ];
  if (snapshot.self?.alive === false) {
    entities.push(snapshot.self);
  }

  for (const entity of entities) {
    const key = renderKey(entity);
    const cached = state.renderEntities.get(key);
    if (!cached) {
      state.renderEntities.set(key, createRenderEntity(entity, seenAt));
      recordSighting(entity);
      continue;
    }

    // Interpolation window: the previous snapshot's state becomes the "from"
    // pose and the fresh one the target, replayed over the measured snapshot
    // gap. Chasing only the latest target instead turns any cadence
    // irregularity (network jitter, the 30 Hz tick vs 24 Hz broadcast beat)
    // straight into visible speed wobble.
    cached.data = entity;
    cached.fromX = cached.targetX;
    cached.fromY = cached.targetY;
    cached.fromRadius = cached.targetRadius;
    cached.fromHeading = cached.targetHeading;
    cached.targetX = entity.x;
    cached.targetY = entity.y;
    cached.targetRadius = entity.radius;
    cached.targetHeading = entity.heading ?? cached.targetHeading;
    cached.snapInterval = clamp(seenAt - cached.snapAt, 20, 250);
    cached.snapAt = seenAt;
    cached.lastSeenAt = seenAt;

    const jumpDistance = Math.hypot(cached.targetX - cached.x, cached.targetY - cached.y);
    if (jumpDistance > Math.max(700, cached.radius * 10)) {
      cached.x = cached.targetX;
      cached.y = cached.targetY;
      cached.radius = cached.targetRadius;
      cached.heading = cached.targetHeading;
      cached.fromX = cached.targetX;
      cached.fromY = cached.targetY;
      cached.fromRadius = cached.targetRadius;
      cached.fromHeading = cached.targetHeading;
      netDebug.hardSnaps += 1;
      netDebug.lastHardSnap = `${key} ${Math.round(jumpDistance)}u`;
      if (netDebug.enabled) {
        console.warn(`[net] hard snap: ${key} jumped ${Math.round(jumpDistance)} units`);
      }
    }
    recordSighting(entity);
  }
}

function createRenderEntity(entity, seenAt) {
  return {
    data: entity,
    x: entity.x,
    y: entity.y,
    radius: entity.radius,
    heading: entity.heading ?? 0,
    swim: 0,
    fromX: entity.x,
    fromY: entity.y,
    fromRadius: entity.radius,
    fromHeading: entity.heading ?? 0,
    targetX: entity.x,
    targetY: entity.y,
    targetRadius: entity.radius,
    targetHeading: entity.heading ?? 0,
    snapAt: seenAt,
    snapInterval: 50,
    lastSeenAt: seenAt
  };
}

export function updateRenderEntities(dt, now) {
  const smoothing = 1 - Math.exp(-dt * 18);
  const radiusSmoothing = 1 - Math.exp(-dt * 10);
  const staleAfterMs = 1400;
  const selfKey = state.playerId ? `player:${state.playerId}` : null;
  const selfInput = selfKey && !state.gamePaused && state.snapshot?.self?.alive !== false ? calculateInput() : null;

  for (const [key, entity] of state.renderEntities.entries()) {
    if (now - entity.lastSeenAt > staleAfterMs) {
      state.renderEntities.delete(key);
      continue;
    }
    // Replay the from→target pose over the measured snapshot gap, then chase
    // that moving point with a light exponential blend. The interpolation
    // supplies constant velocity between snapshots; the blend hides the brief
    // hold when a snapshot arrives late.
    const t = clamp01((now - entity.snapAt) / entity.snapInterval);
    const stepX = entity.targetX - entity.fromX;
    const stepY = entity.targetY - entity.fromY;
    // Your own creature runs one snapshot AHEAD instead of one behind: it is
    // extrapolated from the latest server pose (capped at one gap, so a sudden
    // stop overshoots by at most one snapshot's travel) and turns toward your
    // input at once rather than a round trip later. Visual only — the server
    // stays authoritative and the blend below absorbs any correction.
    const isSelf = key === selfKey;
    const lead = isSelf ? 1 : 0;
    const desiredX = entity.fromX + stepX * (t + lead);
    const desiredY = entity.fromY + stepY * (t + lead);
    const desiredRadius = entity.fromRadius + (entity.targetRadius - entity.fromRadius) * t;
    let desiredHeading = lerpAngle(entity.fromHeading, entity.targetHeading, t);
    if (isSelf && selfInput && (selfInput.x !== 0 || selfInput.y !== 0)) {
      desiredHeading = Math.atan2(selfInput.y, selfInput.x);
    }

    // How hard the creature is swimming right now (0..1) — drives how much its
    // body works in the animation.
    const travel = isSelf ? Math.hypot(stepX, stepY) : Math.hypot(entity.targetX - entity.x, entity.targetY - entity.y);
    entity.swim += (clamp01(travel / Math.max(40, entity.radius * 1.4)) - entity.swim) * radiusSmoothing;

    entity.x += (desiredX - entity.x) * smoothing;
    entity.y += (desiredY - entity.y) * smoothing;
    entity.radius += (desiredRadius - entity.radius) * radiusSmoothing;
    entity.heading = lerpAngle(entity.heading, desiredHeading, smoothing);
  }
}

export function getRenderedEntities(entities) {
  return entities.map((entity) => getRenderedEntity(entity) ?? entity);
}

export function getRenderedEntity(entity) {
  if (!entity) {
    return null;
  }
  const cached = state.renderEntities.get(renderKey(entity));
  if (!cached) {
    return null;
  }
  return {
    ...cached.data,
    x: cached.x,
    y: cached.y,
    radius: cached.radius,
    heading: cached.heading,
    swim: cached.swim
  };
}

function renderKey(entity) {
  return `${entity.kind}:${entity.id}`;
}

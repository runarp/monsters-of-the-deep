import { boostButton, zoomControl, zoomInButton, zoomOutButton, zoomSlider } from "./dom.js";
import { transportReady, transportSend } from "./network.js";
import { state, viewport } from "./state.js";
import { clamp } from "./util.js";

// Input is only sent when it changes, plus a slow resend so a dropped or
// reordered message can't leave the server steering on a stale direction.
export const INPUT_POLL_MS = 33;

const INPUT_KEEPALIVE_MS = 250;

const USER_ZOOM_MIN = 0.4;

const USER_ZOOM_MAX = 1.8;

const USER_ZOOM_STEP = 1.12;

// Solo mode auto-pauses after IDLE_PAUSE_MS without any real user input, so a
// creature left unattended freezes instead of drifting toward the resting
// cursor and getting eaten. Any input resumes instantly.
export const IDLE_PAUSE_MS = 30_000;

export function markActivity() {
  state.lastInputAt = performance.now();
  state.local?.setPaused(false);
}

// iPadOS often skips touchend when the app is backgrounded mid-hold, leaving
// boost stuck on and draining mass the moment play resumes.
export function resetTouchInput() {
  state.pointer.down = false;
  state.pointer.active = false;
  state.touchBoost = false;
  state.keys.delete("Space");
  boostButton?.classList.remove("is-active");
}

// Surfaces a one-tap "Install" button when the browser (e.g. Chrome on a
// Chromebook) reports the app is installable, so there's no installer to run.
export function setUserZoom(value) {
  state.camera.userZoom = clamp(value, USER_ZOOM_MIN, USER_ZOOM_MAX);
  if (zoomSlider) {
    const rounded = Number(state.camera.userZoom.toFixed(2));
    zoomSlider.value = String(rounded);
    zoomSlider.setAttribute("aria-valuenow", String(rounded));
  }
}

function adjustUserZoom(factor) {
  setUserZoom(state.camera.userZoom * factor);
}

export function setZoomControlVisible(visible) {
  if (zoomControl) {
    zoomControl.hidden = !visible;
  }
}

export function setupZoomControls() {
  if (!zoomControl) {
    return;
  }
  zoomOutButton?.addEventListener("click", () => adjustUserZoom(1 / USER_ZOOM_STEP));
  zoomInButton?.addEventListener("click", () => adjustUserZoom(USER_ZOOM_STEP));
  zoomSlider?.addEventListener("input", () => {
    setUserZoom(Number(zoomSlider.value));
  });
  boostButton?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    state.touchBoost = true;
    boostButton.classList.add("is-active");
    boostButton.setPointerCapture(event.pointerId);
  });
  const releaseBoost = () => {
    state.touchBoost = false;
    boostButton?.classList.remove("is-active");
  };
  boostButton?.addEventListener("pointerup", releaseBoost);
  boostButton?.addEventListener("pointercancel", releaseBoost);
  setUserZoom(state.camera.userZoom);
}

export function sendInput() {
  if (!state.joined || !transportReady()) {
    return;
  }
  if (state.gamePaused) {
    return;
  }
  const input = calculateInput();
  const now = performance.now();
  const last = state.lastSentInput;
  if (
    last &&
    last.x === input.x &&
    last.y === input.y &&
    last.boost === input.boost &&
    now - state.lastSentInputAt < INPUT_KEEPALIVE_MS
  ) {
    return;
  }
  state.lastSentInput = input;
  state.lastSentInputAt = now;
  transportSend({ type: "input", ...input });
}

export function calculateInput() {
  let x = 0;
  let y = 0;

  if (state.moveScheme === "esdf") {
    if (state.keys.has("KeyS")) {
      x -= 1;
    }
    if (state.keys.has("KeyF")) {
      x += 1;
    }
    if (state.keys.has("KeyE")) {
      y -= 1;
    }
    if (state.keys.has("KeyD")) {
      y += 1;
    }
  } else {
    if (state.keys.has("KeyA")) {
      x -= 1;
    }
    if (state.keys.has("KeyD")) {
      x += 1;
    }
    if (state.keys.has("KeyW")) {
      y -= 1;
    }
    if (state.keys.has("KeyS")) {
      y += 1;
    }
  }

  if (state.keys.has("ArrowLeft")) {
    x -= 1;
  }
  if (state.keys.has("ArrowRight")) {
    x += 1;
  }
  if (state.keys.has("ArrowUp")) {
    y -= 1;
  }
  if (state.keys.has("ArrowDown")) {
    y += 1;
  }

  if (x === 0 && y === 0 && state.pointer.active) {
    const dx = state.pointer.x - viewport.width / 2;
    const dy = state.pointer.y - viewport.height / 2;
    const distance = Math.hypot(dx, dy);
    if (distance > 22) {
      x = dx / distance;
      y = dy / distance;
    }
  } else {
    const distance = Math.hypot(x, y);
    if (distance > 0) {
      x /= distance;
      y /= distance;
    }
  }

  return {
    x: Number(x.toFixed(3)),
    y: Number(y.toFixed(3)),
    boost: state.keys.has("Space") || (state.pointer.down && state.pointer.isMouse) || state.touchBoost
  };
}

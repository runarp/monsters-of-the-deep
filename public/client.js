// Entry point for the browser client. The pieces live in ./client/:
//   state/dom/util — shared state, element refs, helpers
//   network        — socket or offline transport, message handling, joining
//   entities       — snapshot interpolation into render entities
//   render         — frame loop, camera, ocean, food, hazards, add-ons
//   creatures      — creature/sprite drawing, threat rings, nameplates
//   hud/hover      — HUD, event feed, leaderboard, hover verdicts
//   globe          — minimap globe and region tips
//   speciesLog     — the "Creatures spotted" field guide
//   menu/input     — join screen, creature picker, controls, zoom
// This file only boots the client and wires DOM events.
import { clearSavedRun } from "/localGame.js";
import {
  canvas,
  clearSaveButton,
  joinButton,
  minimapCanvas,
  playerNameInput,
  regionTip,
  resumeBlock,
  resumeCheckbox,
  speciesLogButton
} from "./client/dom.js";
import { updateRegionTip } from "./client/globe.js";
import {
  IDLE_PAUSE_MS,
  INPUT_POLL_MS,
  markActivity,
  sendInput,
  setupZoomControls,
  setUserZoom
} from "./client/input.js";
import {
  initSavedRun,
  quickNameButtons,
  renderCreaturePicker,
  setupInstallPrompt,
  syncQuickNameHighlight,
  updateJoinState
} from "./client/menu.js";
import { connect, joinGame, registerServiceWorker } from "./client/network.js";
import { frame, resize } from "./client/render.js";
import { toggleSpeciesLog } from "./client/speciesLog.js";
import { netDebug, state } from "./client/state.js";

resize();
initSavedRun();
renderCreaturePicker();
updateJoinState();
registerServiceWorker();
setupInstallPrompt();
setupZoomControls();
connect();
requestAnimationFrame(frame);

// Polled at the server's 30 Hz tick rate — faster input is never simulated.
setInterval(sendInput, INPUT_POLL_MS);

window.addEventListener("resize", resize);

window.addEventListener("beforeunload", () => {
  state.unloading = true;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
  }
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.close(1000, "page unload");
  }
  if (state.local) {
    state.local.stop();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) {
    return;
  }
  state.keys.add(event.code);
  // Latch the movement layout by each scheme's EXCLUSIVE keys (W/A vs E/F).
  // S and D are shared, so they alone can't disambiguate — using them to pick
  // the scheme is what made "down" (S) veer sideways.
  if (event.code === "KeyW" || event.code === "KeyA") {
    state.moveScheme = "wasd";
  } else if (event.code === "KeyE" || event.code === "KeyF") {
    state.moveScheme = "esdf";
  }
  if (event.code === "Backquote") {
    netDebug.enabled = !netDebug.enabled;
  }
  if (event.code === "KeyL" && state.joined) {
    toggleSpeciesLog();
  }
});

window.addEventListener("keyup", (event) => {
  state.keys.delete(event.code);
});

canvas.addEventListener("mousemove", (event) => {
  state.pointer.x = event.clientX;
  state.pointer.y = event.clientY;
  state.pointer.active = true;
  state.pointer.isMouse = true;
});

canvas.addEventListener("mousedown", () => {
  state.pointer.down = true;
});

// Wheel / trackpad pinch adjusts a manual zoom factor on top of the
// mass-driven camera scale, so players can pull back to take in their size.
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    setUserZoom(state.camera.userZoom * Math.exp(-event.deltaY * 0.0011));
  },
  { passive: false }
);

window.addEventListener("mouseup", () => {
  state.pointer.down = false;
});

canvas.addEventListener(
  "touchstart",
  (event) => {
    const touch = event.touches[0];
    state.pointer.x = touch.clientX;
    state.pointer.y = touch.clientY;
    state.pointer.active = true;
    state.pointer.isMouse = false;
    event.preventDefault();
  },
  { passive: false }
);

canvas.addEventListener(
  "touchmove",
  (event) => {
    const touch = event.touches[0];
    state.pointer.x = touch.clientX;
    state.pointer.y = touch.clientY;
    state.pointer.active = true;
    event.preventDefault();
  },
  { passive: false }
);

window.addEventListener("touchend", () => {
  state.pointer.down = false;
});

for (const type of ["keydown", "pointerdown", "pointermove", "touchstart", "touchmove", "touchend", "wheel"]) {
  window.addEventListener(type, markActivity, { passive: true });
}

setInterval(() => {
  if (state.mode !== "offline" || !state.local || !state.joined) {
    return;
  }
  if (performance.now() - state.lastInputAt > IDLE_PAUSE_MS) {
    state.local.setPaused(true);
  }
}, 1000);

joinButton.addEventListener("click", () => {
  joinGame();
});

playerNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinGame();
  }
});

playerNameInput.addEventListener("input", () => {
  syncQuickNameHighlight();
  updateJoinState();
});

for (const button of quickNameButtons) {
  button.addEventListener("click", () => {
    playerNameInput.value = button.dataset.name;
    syncQuickNameHighlight();
    updateJoinState();
  });
}

resumeCheckbox?.addEventListener("change", () => {
  state.resumeOffline = resumeCheckbox.checked;
});

clearSaveButton?.addEventListener("click", () => {
  clearSavedRun();
  state.resumeOffline = false;
  if (resumeBlock) {
    resumeBlock.hidden = true;
  }
});

speciesLogButton?.addEventListener("click", () => {
  toggleSpeciesLog();
});

minimapCanvas?.addEventListener("mousemove", (event) => {
  updateRegionTip(event.clientX, event.clientY);
});

minimapCanvas?.addEventListener("mouseleave", () => {
  if (regionTip) {
    regionTip.hidden = true;
  }
});

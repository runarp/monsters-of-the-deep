import { CREATURE_CATALOG, PLAYABLE_CREATURE_IDS } from "/shared/creatureCatalog.js";
import { loadSavedRun } from "/localGame.js";
import { getSpriteImage, spriteSourceRect } from "./creatures.js";
import {
  creaturePicker,
  installButton,
  joinButton,
  nameError,
  playerNameInput,
  resumeBlock,
  resumeCheckbox,
  resumeText
} from "./dom.js";
import { showToast } from "./hud.js";
import { state } from "./state.js";
import { blend, colorWithAlpha } from "./util.js";

export const quickNameButtons = [...document.querySelectorAll(".quick-name")];

// Highlight the quick-name chip that matches the current field value (if any),
// so a picked name reads as selected and a typed one clears the highlight.
export function syncQuickNameHighlight() {
  const current = playerNameInput.value.trim().toLowerCase();
  for (const button of quickNameButtons) {
    button.classList.toggle("is-active", button.dataset.name.toLowerCase() === current);
  }
}

export function renderCreaturePicker() {
  creaturePicker.replaceChildren();
  for (const creatureId of PLAYABLE_CREATURE_IDS) {
    const creature = CREATURE_CATALOG[creatureId];
    const option = document.createElement("button");
    option.type = "button";
    option.className = "creature-option";
    option.setAttribute("role", "radio");
    option.setAttribute("aria-checked", String(creature.id === state.selectedCreatureId));

    const swatch = document.createElement("canvas");
    swatch.className = "creature-portrait";
    swatch.width = 420;
    swatch.height = 150;

    const title = document.createElement("strong");
    title.textContent = creature.name;

    const description = document.createElement("span");
    description.textContent = creature.summary ?? descriptorFor(creature);

    if (creature.trait) {
      const traitLine = document.createElement("span");
      traitLine.className = "creature-trait";
      traitLine.textContent = `${creature.trait.name} — ${creature.trait.summary}`;
      option.append(swatch, title, description, traitLine);
    } else {
      option.append(swatch, title, description);
    }
    drawCreaturePortrait(swatch, creature);
    option.addEventListener("click", () => {
      state.selectedCreatureId = creature.id;
      renderCreaturePicker();
    });
    creaturePicker.append(option);
  }
}

function descriptorFor(creature) {
  if (creature.summary) {
    return creature.summary;
  }
  if (creature.visual.shape === "serpent") {
    return "Fast coils, sharp growth spikes, narrow turns.";
  }
  if (creature.visual.shape === "kraken") {
    return "Agile bursts, soft body, strong add-on control.";
  }
  return "Wide glide, heavy momentum, stable late growth.";
}

function drawCreaturePortrait(canvas, creature) {
  const context = canvas.getContext("2d");
  const visual = creature.visual;
  const { width: canvasWidth, height: canvasHeight } = canvas;

  if (drawSpritePortrait(context, visual, canvasWidth, canvasHeight)) {
    return;
  }

  const gradient = context.createLinearGradient(0, 0, canvasWidth, canvasHeight);
  gradient.addColorStop(0, "#03151b");
  gradient.addColorStop(0.48, blend(visual.body, "#02080c", 0.58));
  gradient.addColorStop(1, "#061b25");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  context.save();
  context.globalAlpha = 0.26;
  context.strokeStyle = visual.accent;
  context.lineWidth = 2;
  for (let index = 0; index < 5; index += 1) {
    const y = 24 + index * 25;
    context.beginPath();
    for (let x = -20; x <= canvasWidth + 20; x += 28) {
      const wave = Math.sin(x * 0.04 + index) * 5;
      if (x === -20) {
        context.moveTo(x, y + wave);
      } else {
        context.lineTo(x, y + wave);
      }
    }
    context.stroke();
  }
  context.restore();

  context.save();
  context.translate(canvasWidth * 0.54, canvasHeight * 0.54);
  context.rotate(-0.08);
  const radius = 40;
  if (visual.shape === "kraken") {
    drawPortraitKraken(context, radius, visual);
  } else if (visual.shape === "ray") {
    drawPortraitRay(context, radius, visual);
  } else if (visual.shape === "whale") {
    drawPortraitWhale(context, radius, visual);
  } else if (visual.shape === "maw") {
    drawPortraitMaw(context, radius, visual);
  } else if (visual.shape === "angler") {
    drawPortraitAngler(context, radius, visual);
  } else {
    drawPortraitSerpent(context, radius, visual);
  }
  context.restore();
}

function drawSpritePortrait(context, visual, canvasWidth, canvasHeight) {
  const sprite = visual.animationSprite ?? visual.sprite;
  const image = getSpriteImage(sprite, () => renderCreaturePicker());
  if (!sprite || !image?.complete || image.naturalWidth === 0) {
    return false;
  }

  const source = spriteSourceRect(sprite, image);
  context.save();
  context.fillStyle = "#020c12";
  context.fillRect(0, 0, canvasWidth, canvasHeight);
  context.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, canvasWidth, canvasHeight);

  const shade = context.createLinearGradient(0, 0, 0, canvasHeight);
  shade.addColorStop(0, "rgba(255,255,255,0.05)");
  shade.addColorStop(0.62, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.34)");
  context.fillStyle = shade;
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  context.strokeStyle = colorWithAlpha(visual.accent, 0.7);
  context.lineWidth = 3;
  context.strokeRect(1.5, 1.5, canvasWidth - 3, canvasHeight - 3);
  context.restore();
  return true;
}

function drawPortraitSerpent(context, radius, visual) {
  for (let index = 6; index >= 0; index -= 1) {
    context.fillStyle = index % 2 === 0 ? visual.body : blend(visual.body, visual.belly, 0.22);
    context.beginPath();
    context.ellipse(-index * radius * 0.5, Math.sin(index) * 9, radius * (0.72 - index * 0.035), radius * 0.42, 0, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = visual.body;
  context.strokeStyle = visual.accent;
  context.lineWidth = 4;
  context.beginPath();
  context.ellipse(radius * 0.4, 0, radius * 1.05, radius * 0.62, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  portraitEye(context, radius, visual);
}

function drawPortraitKraken(context, radius, visual) {
  context.strokeStyle = visual.accent;
  context.lineWidth = 5;
  for (let index = -3; index <= 3; index += 1) {
    context.beginPath();
    context.moveTo(-radius * 0.25, index * 7);
    context.quadraticCurveTo(-radius * 1.4, index * 14, -radius * 2.1, index * 11 + Math.sin(index) * 12);
    context.stroke();
  }
  const gradient = context.createRadialGradient(radius * 0.25, -radius * 0.2, 6, 0, 0, radius * 1.15);
  gradient.addColorStop(0, visual.belly);
  gradient.addColorStop(0.45, visual.body);
  gradient.addColorStop(1, blend(visual.body, "#02080c", 0.45));
  context.fillStyle = gradient;
  context.beginPath();
  context.ellipse(radius * 0.18, 0, radius * 0.95, radius * 1.05, 0, 0, Math.PI * 2);
  context.fill();
  portraitEye(context, radius * 0.9, visual);
}

function drawPortraitRay(context, radius, visual) {
  const gradient = context.createRadialGradient(radius * 0.22, 0, 4, 0, 0, radius * 1.9);
  gradient.addColorStop(0, visual.belly);
  gradient.addColorStop(0.48, visual.body);
  gradient.addColorStop(1, blend(visual.body, "#02080c", 0.4));
  context.fillStyle = gradient;
  context.strokeStyle = visual.accent;
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(radius * 1.6, 0);
  context.bezierCurveTo(radius * 0.42, -radius * 1.2, -radius * 1.55, -radius, -radius * 1.9, 0);
  context.bezierCurveTo(-radius * 1.55, radius, radius * 0.42, radius * 1.2, radius * 1.6, 0);
  context.closePath();
  context.fill();
  context.stroke();
  portraitEye(context, radius * 0.82, visual);
}

function drawPortraitWhale(context, radius, visual) {
  context.fillStyle = visual.body;
  context.strokeStyle = visual.accent;
  context.lineWidth = 4;
  context.beginPath();
  context.ellipse(0, 0, radius * 1.9, radius * 0.76, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = visual.belly;
  context.beginPath();
  context.ellipse(radius * 0.38, radius * 0.22, radius * 1.1, radius * 0.28, 0, 0, Math.PI * 2);
  context.fill();
  portraitEye(context, radius, visual);
}

function drawPortraitMaw(context, radius, visual) {
  context.fillStyle = visual.body;
  context.strokeStyle = visual.accent;
  context.lineWidth = 4;
  context.beginPath();
  context.ellipse(0, 0, radius * 1.55, radius * 0.92, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = "#02080c";
  context.beginPath();
  context.ellipse(radius * 0.38, 0, radius * 0.78, radius * 0.46, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = visual.belly;
  for (let index = -4; index <= 4; index += 1) {
    context.beginPath();
    context.moveTo(radius * 0.08 + index * 7, -radius * 0.3);
    context.lineTo(radius * 0.18 + index * 7, -radius * 0.02);
    context.lineTo(radius * 0.28 + index * 7, -radius * 0.3);
    context.fill();
  }
  portraitEye(context, radius, visual);
}

function drawPortraitAngler(context, radius, visual) {
  drawPortraitMaw(context, radius, visual);
  context.strokeStyle = visual.accent;
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(radius * 0.2, -radius * 0.6);
  context.quadraticCurveTo(radius * 0.7, -radius * 1.35, radius * 1.1, -radius * 1.05);
  context.stroke();
  context.fillStyle = visual.accent;
  context.beginPath();
  context.arc(radius * 1.18, -radius * 1.02, 7, 0, Math.PI * 2);
  context.fill();
}

function portraitEye(context, radius, visual) {
  context.fillStyle = visual.eye;
  context.beginPath();
  context.arc(radius * 0.7, -radius * 0.22, Math.max(4, radius * 0.11), 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#02080c";
  context.beginPath();
  context.arc(radius * 0.73, -radius * 0.22, Math.max(2, radius * 0.05), 0, Math.PI * 2);
  context.fill();
}

export function initSavedRun() {
  const saved = loadSavedRun();
  if (!saved) {
    state.resumeOffline = false;
    return;
  }
  state.resumeOffline = true;
  if (PLAYABLE_CREATURE_IDS.includes(saved.creatureId)) {
    state.selectedCreatureId = saved.creatureId;
  }
  if (saved.name && !playerNameInput.value) {
    playerNameInput.value = saved.name;
  }
  if (resumeBlock && resumeText) {
    const creatureName = CREATURE_CATALOG[saved.creatureId]?.name ?? "creature";
    resumeText.textContent = `Resume solo run · ${creatureName} · mass ${Math.round(saved.mass).toLocaleString()}`;
    resumeBlock.hidden = false;
    if (resumeCheckbox) {
      resumeCheckbox.checked = true;
    }
  }
}

export function setupInstallPrompt() {
  if (!installButton) {
    return;
  }
  if (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone) {
    return;
  }

  // iOS/iPadOS browsers are all WebKit and never fire beforeinstallprompt, so
  // the install button can't work there. Show the manual Add to Home Screen hint.
  const userAgent = window.navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (window.navigator.maxTouchPoints > 1 && /Macintosh/.test(userAgent));
  if (isIOS) {
    const iosHint = document.querySelector("#iosInstallHint");
    if (iosHint) {
      iosHint.hidden = false;
    }
    return;
  }

  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!deferredPrompt) {
      return;
    }
    installButton.disabled = true;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    installButton.hidden = true;
    installButton.disabled = false;
    if (choice?.outcome === "accepted") {
      showToast("Installed — look on your shelf");
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installButton.hidden = true;
    showToast("Installed — look on your shelf");
  });
}

export function updateJoinState(errorText = "") {
  const valid = isValidNameInput();
  joinButton.disabled = !valid;
  nameError.textContent = valid ? "" : errorText;
}

export function sanitizedNameInput() {
  return playerNameInput.value
    .replace(/[^\w .'-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18);
}

export function isValidNameInput() {
  return sanitizedNameInput().length > 0;
}

import { geoPositionAt, REGIONS } from "/shared/geography.js";
import { signatureSpeciesForRegion } from "/shared/speciesCatalog.js";
import { minimapCanvas, minimapCtx, regionTip } from "./dom.js";
import { viewport } from "./state.js";
import { blend } from "./util.js";

// Each ocean gets its own water colour, so the globe reads as real basins:
// swimming east carries you Atlantic → Arctic → Southern → Pacific and home.
const OCEAN_COLORS = {
  "Atlantic Ocean": "#1d5c8a",
  "Arctic Ocean": "#2b6f86",
  "Southern Ocean": "#3a5a86",
  "Pacific Ocean": "#155e6b",
  "Indian Ocean": "#1f6b7a"
};

const DEG = Math.PI / 180;

// The player's world x maps to a real longitude/latitude (see geoPositionAt),
// and the minimap is an orthographic globe centred on that point — so the
// player dot sits at the centre and the world literally turns beneath them as
// they swim. Region homes are plotted at their real coordinates; the ones on
// the near hemisphere are hoverable dots.
let projectedRegions = [];

export function drawGlobe(worldX) {
  if (!minimapCtx) {
    return;
  }
  const size = minimapCanvas.width;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 6;
  const geo = geoPositionAt(worldX);
  const lon0 = geo.lon * DEG;
  const lat0 = geo.lat * DEG;
  const sinLat0 = Math.sin(lat0);
  const cosLat0 = Math.cos(lat0);

  const project = (latDeg, lonDeg) => {
    const lat = latDeg * DEG;
    const lon = lonDeg * DEG;
    const dLon = lon - lon0;
    const cosc = sinLat0 * Math.sin(lat) + cosLat0 * Math.cos(lat) * Math.cos(dLon);
    const px = Math.cos(lat) * Math.sin(dLon);
    const py = cosLat0 * Math.sin(lat) - sinLat0 * Math.cos(lat) * Math.cos(dLon);
    return { x: cx + radius * px, y: cy - radius * py, visible: cosc >= -0.02 };
  };

  minimapCtx.clearRect(0, 0, size, size);

  // Ocean sphere: a soft radial gradient reads as a lit globe. Tinted toward
  // the ocean the player is currently in.
  const currentRegion = REGIONS[regionIndexForGlobe(worldX)];
  const water = OCEAN_COLORS[currentRegion.ocean] ?? "#155e6b";
  const sphere = minimapCtx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, radius * 0.2, cx, cy, radius);
  sphere.addColorStop(0, blend(water, "#dffbff", 0.28));
  sphere.addColorStop(0.7, water);
  sphere.addColorStop(1, blend(water, "#02080c", 0.6));
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  minimapCtx.fillStyle = sphere;
  minimapCtx.fill();

  // Graticule (front hemisphere only) for a globe feel.
  minimapCtx.strokeStyle = "rgba(223, 251, 255, 0.14)";
  minimapCtx.lineWidth = 0.6;
  for (const lat of [-60, -30, 0, 30, 60]) {
    strokeArc(minimapCtx, (lon) => project(lat, lon), -180, 180, lat === 0 ? 0.22 : 0.14);
  }
  for (let lon = -180; lon < 180; lon += 30) {
    strokeArc(minimapCtx, (lat) => project(lat, lon), -90, 90, 0.14);
  }

  // Region dots at their real coordinates.
  projectedRegions = [];
  for (let index = 0; index < REGIONS.length; index += 1) {
    const region = REGIONS[index];
    const point = project(region.lat, region.lon);
    projectedRegions.push({ region, x: point.x, y: point.y, visible: point.visible });
    if (!point.visible) {
      continue;
    }
    const isCurrent = region.id === currentRegion.id;
    const dotColor =
      region.danger >= 3 ? "#fb7185" : region.danger === 2 ? "#fbbf24" : "#5eead4";
    minimapCtx.beginPath();
    minimapCtx.arc(point.x, point.y, isCurrent ? 4.5 : 3, 0, Math.PI * 2);
    minimapCtx.fillStyle = dotColor;
    minimapCtx.fill();
    minimapCtx.lineWidth = 1;
    minimapCtx.strokeStyle = "rgba(2, 8, 12, 0.7)";
    minimapCtx.stroke();
    if (isCurrent) {
      minimapCtx.beginPath();
      minimapCtx.arc(point.x, point.y, 7.5, 0, Math.PI * 2);
      minimapCtx.strokeStyle = "rgba(253, 230, 138, 0.9)";
      minimapCtx.lineWidth = 1.5;
      minimapCtx.stroke();
    }
  }

  // Limb outline on top so dots near the edge stay contained.
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  minimapCtx.strokeStyle = "rgba(223, 251, 255, 0.4)";
  minimapCtx.lineWidth = 1;
  minimapCtx.stroke();

  // Player marker at the centre (the globe is centred on them).
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, 2.6, 0, Math.PI * 2);
  minimapCtx.fillStyle = "#fde68a";
  minimapCtx.fill();
  minimapCtx.strokeStyle = "#02080c";
  minimapCtx.lineWidth = 1;
  minimapCtx.stroke();
}

// Local mirror of geography.regionIndexAt (client keeps geography's REGIONS but
// not its private helpers).
function regionIndexForGlobe(worldX) {
  return REGIONS.indexOf(regionAtGlobe(worldX));
}

function regionAtGlobe(worldX) {
  const cell = 9000 * REGIONS.length;
  const wrapped = ((worldX % cell) + cell) % cell;
  return REGIONS[Math.floor(wrapped / 9000)];
}

// Stroke a projected great-circle arc, lifting the pen when it passes behind
// the globe so only the visible hemisphere is drawn.
function strokeArc(context, projectAt, from, to, alpha) {
  context.save();
  context.globalAlpha = alpha / 0.22; // keep the equator a touch brighter
  context.beginPath();
  let drawing = false;
  for (let t = from; t <= to; t += 6) {
    const point = projectAt(t);
    if (point.visible) {
      if (drawing) {
        context.lineTo(point.x, point.y);
      } else {
        context.moveTo(point.x, point.y);
        drawing = true;
      }
    } else {
      drawing = false;
    }
  }
  context.stroke();
  context.restore();
}

// Hover on the globe: report the nearest near-side region dot under the cursor.
export function updateRegionTip(clientX, clientY) {
  if (!regionTip || !minimapCanvas) {
    return;
  }
  const rect = minimapCanvas.getBoundingClientRect();
  const scaleX = minimapCanvas.width / rect.width;
  const scaleY = minimapCanvas.height / rect.height;
  const localX = (clientX - rect.left) * scaleX;
  const localY = (clientY - rect.top) * scaleY;

  let best = null;
  let bestDistance = 11;
  for (const dot of projectedRegions) {
    if (!dot.visible) {
      continue;
    }
    const distance = Math.hypot(dot.x - localX, dot.y - localY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = dot.region;
    }
  }

  if (!best) {
    regionTip.hidden = true;
    return;
  }

  const species = signatureSpeciesForRegion(best.id, 4)
    .map((entry) => entry.name)
    .join(", ");
  regionTip.replaceChildren();
  const title = document.createElement("div");
  title.className = "tip-title";
  title.textContent = best.name + dangerPips(best);
  const meta = document.createElement("div");
  meta.className = "tip-detail";
  meta.textContent = `${best.ocean} · ${dangerWord(best)}`;
  regionTip.append(title, meta);
  if (species) {
    const life = document.createElement("div");
    life.className = "tip-detail";
    life.textContent = species;
    regionTip.append(life);
  }
  regionTip.hidden = false;
  const tipRect = regionTip.getBoundingClientRect();
  let left = clientX + 14;
  let top = clientY - tipRect.height - 10;
  if (left + tipRect.width > viewport.width - 8) {
    left = clientX - tipRect.width - 14;
  }
  if (top < 8) {
    top = clientY + 14;
  }
  regionTip.style.left = `${Math.max(8, left)}px`;
  regionTip.style.top = `${Math.max(8, top)}px`;
}

function dangerWord(region) {
  const danger = region.danger ?? 1;
  return danger >= 3 ? "perilous waters" : danger === 2 ? "open hunting" : "calm nursery";
}

// Danger pips after a sea's name: nothing for calm seas, ⚠/⚠⚠ for waters that
// breed bigger creatures — readable long before you learn it the hard way.
export function dangerPips(region) {
  const danger = region.danger ?? 1;
  return danger > 1 ? ` ${"⚠".repeat(danger - 1)}` : "";
}

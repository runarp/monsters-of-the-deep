# Monsters of the Deep — Player Guide

Grow from a fragile hatchling into the largest predator in the ocean. Eat to gain mass, unlock new prey, survive hazards, and — in multiplayer — compete for the top of the leaderboard.

This guide explains how the game works, what the UI means, and how to play well.

---

## Getting started

1. **Enter a name** — required before you can join.
2. **Pick a creature** — each playable monster has different movement feel and a unique passive **trait** (shown in green on the selection card). Traits are subtle bonuses, not superpowers — choose one that fits how you like to swim.
3. **Enter the Deep** — the game tries to connect to the online server first. If it cannot, it falls back to **offline solo** automatically (same rules, just you and the ocean).

**Offline solo only:** if you have a saved run, you can resume at your previous mass or start fresh.

---

## Controls

| Input | Action |
|---|---|
| **WASD** or **ESDF** | Swim in that direction |
| **Mouse position** | Steer toward the cursor when no movement keys are held |
| **Space**, **hold mouse button**, or **⚡ Boost** | Burst sprint (see below) |
| **Mouse wheel** / **trackpad pinch**, or the **zoom slider** (− / +) | Zoom the camera in or out |
| **L** | Open the **Creatures spotted** field guide |
| **`** (backtick) or `?debug` in the URL | Toggle network/render debug overlay |

On **touch devices**, drag on the canvas to steer. Use the **⚡** button (next to the zoom slider) to boost — touching the canvas alone does not boost.

---

## Boost — what it is and when to use it

**Boost** is a burst sprint: you swim faster and accelerate harder for as long as you hold it.

### How to trigger boost

- **Keyboard:** hold **Space**
- **Mouse:** hold the **left mouse button** while playing on desktop
- **Touch:** hold the **⚡** button in the bottom-right zoom control

### What boost does

While boost is active **and** you are big enough to use it:

- **Speed** increases by about **36%**
- **Acceleration** increases — you snap into turns faster
- **Mass drains** continuously — you burn body mass to pay for the sprint (roughly **0.6% of your current mass per second**)

You must be slightly above your starting size to boost (about **12% above base mass**). Hatchlings fresh off the spawn cannot boost yet — graze a little first.

### Strategy

- Boost to **escape** a predator, **catch** fleeing prey, or **cross** a hazard quickly.
- Do not hold boost while grazing plankton — you lose mass for no reason.
- **Craken** has the **Ambush Ink** trait, which makes boost cheaper. Good for hit-and-run play.
- If you are huge, even a short boost costs a lot of mass. Use it deliberately.

---

## Core mechanics

### Mass and growth stages

**Mass** is your size and power. It goes up when you eat and down when hazards drain you or you boost.

Your **Stage** (shown in the HUD) is a named growth milestone:

Hatchling → Juvenile → Hunter → Giant → Leviathan → Abyss King → Trench Lord → Titan → World Eater → Hadal God → Tide Sovereign → Ocean Incarnate → The Deep Itself → …

Early stages come quickly. From **Giant** onward, each stage typically takes **2–5 minutes** of steady eating if you are playing well.

Growth slows at very high mass, but the ceiling is enormous (up to **20,000,000** mass). The camera zooms out as you grow, but more slowly than you expand — true giants overflow the screen.

### Eating

Swim into something to eat it. You need both **size** and **diet**:

- **Food** (plankton, krill, jellies, tiny fish…) — always edible if you touch it and you are big enough relative to its mass.
- **Creatures** (NPC fish, other players) — you must be visibly **larger in radius** than your target, not just slightly heavier in mass. If you are bigger on screen, you can often swallow prey **even before** your diet officially unlocks that type.
- **Other players** — same size rules. Bigger eats smaller. There is no safe size in multiplayer.

When you eat a creature, its **scientific name** may appear in the event feed at the bottom of the screen.

### Movement and depth

- Swim **up** (smaller Y) to reach **shallower** water; swim **down** for **deeper** zones.
- You cannot pass the **surface** or the **hadal floor** — they are hard boundaries.
- The ocean extends **endlessly** horizontally. Named **seas** are longitude bands on a circumnavigation of the real globe; **depth zones** are vertical bands from Sunlight down to Hadal.

The HUD shows your current **region**, **depth zone**, and **depth in metres** once you are in the world.

---

## Add-ons — the orbiting attachments

While swimming you will see glowing pickups drifting in the water. These are **add-ons**. Swim through one to collect it.

### What “attached” means

Collected add-ons **orbit your creature** as small colored spheres. They are not separate fish you are dragging — they are **power-ups** that stay with you until they expire. The HUD line **Add-ons** lists what you currently have attached (plus **Shield** charges if you carry a pearl shield).

Add-ons **stack** up to a limit. Collecting more of the same type refreshes the timer on an existing stack if you are already at the maximum.

Your **magnet** (a passive pull radius around you) draws both **food** and **add-on pickups** toward you. Several traits and add-ons widen this radius.

### The four add-ons

| Add-on | Duration | Max stacks | Effect |
|---|---|---|---|
| **Tide Ribbon** | 45 s | 3 | +10% speed and wider food magnet per stack |
| **Remora Swarm** | 60 s | 4 | +8% digestion (more mass from each bite) per stack |
| **Coral Spurs** | 50 s | 2 | +5% bite reach (swallow slightly larger prey) per stack |
| **Pearl Shield** | 70 s | 2 | +1 shield charge per stack |

### Pearl Shield — special case

Shield charges are shown as **Shield 1**, **Shield 2**, etc. in the add-ons line.

If something **lethal** tries to eat you while you have a shield charge:

- The bite is **blocked**
- You lose **one shield charge**
- You lose a little mass and get **knocked back**
- You are briefly **invulnerable**

Pearl shields are rare pickups but can save a run.

### Add-on strategy

- **Tide Ribbon** — chase prey, escape, or cross open water faster.
- **Remora Swarm** — best when you are actively feeding; more mass per meal speeds up stage progression.
- **Coral Spurs** — helps at size thresholds where you are *almost* big enough to eat the next tier of fish.
- **Pearl Shield** — grab before entering dangerous seas or when apex hunters are nearby.

Add-ons expire. Keep an eye on the HUD and re-collect them during long hunts.

---

## Creature traits (passive powers)

Each playable creature has one passive **trait**, chosen before the run starts. Effects are intentionally small.

| Creature | Trait | What it does |
|---|---|---|
| **Abyssal Serpent** | Pressure Coils | Faster swimming and tighter turns in the Abyssal and Hadal zones |
| **Glass Kraken** | Glass Slip | Takes ~45% less mass loss from drift nets |
| **Reef Leviathan** | Sunlit Glide | +10% speed in the Sunlight (shallow) zone |
| **Craken** | Ambush Ink | Boost costs ~42% less mass |
| **Sea Eater** | Rending Maw | +5% bite reach |
| **Bloop** | Sonar Bloom | +18% growth while mass is below 220 |
| **Katulu** | Hypnotic Lure | Much wider food magnet |
| **El Gram Maga** | Filter Sweep | +12% digestion from plankton and jelly food |
| **Void Angler** | Cold Lantern | +8–10% speed in Twilight/Midnight zones; small extra magnet |
| **Umbral Manta** | Shadow Drift | ~35% reduced pull from maelstroms |

Pick a trait that matches where you plan to hunt (shallow vs deep) or what you fear (nets vs whirlpools).

---

## Hazards

There is **no size** at which you are completely safe.

### Maelstrom (whirlpool)

A living vortex with its **own mass**. Each sea’s whirlpool has a **real name** (Saltstraumen, Corryvreckan, etc.).

- **Pulls** you toward the center
- **Drains mass** in the core if the vortex outweighs you
- **Grows** when it feeds on drained mass — wider, stronger, hungrier
- If you outweigh it by about **1.25× its mass**, the fight **flips**: you grind *it* down and can **swallow the storm** when it collapses

Even apex-sized players can lose to a maelstrom that has fed enough. **Umbral Manta** resists the pull slightly.

### Drift net

A tangled snare that:

- **Slows** movement heavily while you are inside
- **Drains mass** slowly
- Does **not** kill you directly — swim out to escape

**Glass Kraken** takes less drain from nets.

### Spawn protection

You are briefly **invulnerable** after spawning or respawning. Use that window to orient and swim away from trouble.

---

## The world — seas, depth, and fauna

### Seas and danger

The world is an endless eastward voyage around the globe. Each **named sea** is a longitude band with a real **danger level** (shown as ⚠ pips on the minimap and in region tooltips).

- **Safer seas** — good for hatchlings and juveniles
- **Dangerous seas** (e.g. Mariana Approach, Antarctic Convergence) — spawn bigger creatures; hunt here when you are Giant or larger

Species spawn where they **actually live** in real life. Swim to new regions to see different fauna.

### Depth zones

| Zone | Name | Rough depth |
|---|---|---|
| Epipelagic | Sunlight Zone | 0–200 m |
| Mesopelagic | Twilight Zone | 200–1,000 m |
| Bathypelagic | Midnight Zone | 1,000–4,000 m |
| Abyssal | Abyssal Zone | 4,000–6,000 m |
| Hadal | Hadal Zone | 6,000–11,000 m |

Deeper zones tend toward stranger and larger life. Some creature traits only activate in specific zones.

### Oversized “Giant” and “Monster” specimens

The ocean does not stay easy forever. Once local players outgrow a species’ real adult size, the game sometimes spawns **oversized** versions sized to rival apex players. Labels may read **Giant …** or **Monster …**. These can genuinely hunt large players. The world always has something that can threaten you.

---

## Reading the UI

### HUD (top)

- **Mass** — current size
- **Stage** — growth milestone name
- **Add-ons** — attached power-ups and shield charges
- **Region · Zone · depth** — where you are in the world

### Threat rings

Nearby creatures may show a dashed ring:

- **Red (pulsing)** — it **can eat you**
- **Green** — you **can eat it**
- **Amber** — standoff (neither can safely eat the other yet)

**Hover** any creature for a plain verdict: e.g. `0.6× your mass · you can eat it`.

### Event feed (bottom centre)

Short messages for joins, growth milestones, kills, add-on pickups, and your own meals. This is the main “what just happened?” readout.

### Minimap (globe)

An orthographic **globe** centred on your real latitude/longitude. Color-coded dots are named seas; hover a dot to see its ocean, danger level, and signature residents.

### Creatures spotted (🐟 / L)

A personal **field guide** of every species you have seen or eaten. Undiscovered species appear as **???** with hints about where to find them. Discovery milestones grant achievement titles. Progress is saved per browser.

### Leaderboard

Scores combine mass, meals eaten, and player kills. In multiplayer, the table is shared across all connected players.

### Death and respawn

If you are eaten or ground down to base mass in a maelstrom, you **respawn** as a hatchling after a short delay. In **offline solo**, your progress is saved periodically — you can resume later. In **live multiplayer**, you always respawn small; there is no rejoining at your old size.

---

## Strategy tips

### Early game (Hatchling → Hunter)

- Graze **dense food clouds** — plankton, krill, marine snow. Do not boost yet.
- Stay in **safer, shallower seas** until you can handle medium fish.
- Pick a creature trait that helps your preferred depth (**Reef Leviathan** shallow, **Abyssal Serpent** deep).
- Collect **Remora Swarm** and **Tide Ribbon** when you see them.

### Mid game (Giant → Leviathan)

- Hunt **NPC fish** one tier above your comfort zone; use **Coral Spurs** to stretch bite reach.
- Watch **red rings** — tuna, sharks, and squids turn the hunt around fast.
- Learn to **swim out of drift nets** sideways; do not panic-boost inside them unless you must.
- Start exploring **new seas** for richer prey and species log entries.

### Late game (Abyss King and beyond)

- **Maelstroms** are both threats and prizes — an overpowered vortex is a massive meal if you survive the grind.
- Keep **Pearl Shield** when hunting in multiplayer or apex territory.
- Use **zoom** to manage awareness: zoom out to plan routes, zoom in for precision bites.
- Dangerous seas and deep zones are worth the risk once you can eat what lives there.

### Multiplayer

- Other players are the highest-risk, highest-reward prey.
- Score rewards **player kills** heavily — but dying costs your entire run’s mass.
- There is no alliance mechanic. Trust no one bigger than you.

### Offline solo

- The simulation **pauses** after ~30 seconds with no input, and when the tab is hidden — safe for school Chromebooks and battery life.
- Your run **auto-saves** every few seconds. Use **Resume solo run** on the title screen to continue.

---

## Quick reference — eating rules

1. Touch food or prey to consume it.
2. You must be **visibly larger** (radius) to eat another creature.
3. Your **diet** expands as you grow — but size alone can let you eat smaller creatures before a diet tier unlocks.
4. **Add-ons** and **traits** can widen bite reach or digestion slightly.
5. **Hazards** ignore diet — they drain or kill by their own rules.

---

## Still stuck?

- **Can’t boost?** You may still be at hatchling mass. Eat a little more first.
- **Can’t eat that fish?** Hover it — if the ring is amber or red, you need more mass (or Coral Spurs).
- **Stuck in a net?** Hold a movement key and swim **out** of the snare. Do not stop.
- **Stuck in a maelstrom?** Swim **out** if you are small; swim **in** and grind if you outweigh it 1.25×.
- **Add-ons line says None?** Pickups look like small glowing orbs — swim through them. Widen your magnet with Tide Ribbon or lurer traits.

Good hunting. The deep is hungry.

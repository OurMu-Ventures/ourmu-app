"use client";
/* eslint-disable react-hooks/immutability -- preserved self-scheduling animation loop uses a stable empty-dependency callback */

/**
 * FishCanvas v3 — Lake Victoria Aquatic Simulation
 *
 * A semi-realistic aquatic environment featuring species found in Lake Victoria
 * (Tilapia, Nile Perch, Catfish) with physics-based movement, segmented body
 * mechanics, mouse interaction, and environmental particle effects.
 *
 * ARCHITECTURE:
 * ┌─────────────────────────────────────────────┐
 * │  FishCanvas (React component)               │
 * │  ├── AnimationLoop (requestAnimationFrame)   │
 * │  │   ├── updateFish() — physics + behavior   │
 * │  │   ├── updateParticles() — plankton        │
 * │  │   ├── drawEnvironment() — light rays      │
 * │  │   ├── drawFish() — segmented rendering    │
 * │  │   └── drawParticles() — floating specs    │
 * │  └── Mouse tracking (proximity reactions)    │
 * └─────────────────────────────────────────────┘
 *
 * WHY THE PREVIOUS VERSION STILL FELT ARTIFICIAL:
 * - Generic oval shapes (no species identity)
 * - Rigid body rotation (real fish curve their whole body to turn)
 * - No response to user input (fish felt like a screensaver, not alive)
 * - No environmental context (no particles, no light, no depth cues)
 *
 * WHAT MAKES THIS VERSION FEEL ALIVE:
 * - Segmented spine: head leads, body follows in a wave — like real fish
 * - Species-specific shapes, colors, and behavior profiles
 * - Mouse proximity triggers curiosity, fear, or indifference per personality
 * - Floating particles, rising bubbles, and flickering light rays
 * - Fish interact with each other (avoidance, boids-lite tilapia schooling)
 * - Feeding: pellets sink from the surface (auto every 25–45s, or click to
 *   feed) and nearby fish steer in to eat them — aquaculture in miniature
 * - Depth cues: distant fish are tinted toward teal; upper flanks catch a
 *   specular shimmer when they face the light
 */

import { useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════
// NOISE — Smooth pseudo-random values for organic steering
// ═══════════════════════════════════════════════════════════════════════
function noise(x: number, y: number): number {
  const a = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  const b = Math.sin(x * 269.5 + y * 183.3) * 28571.2137;
  const c = Math.sin(x * 419.2 + y * 97.1) * 65537.1793;
  return (
    ((a - Math.floor(a)) * 0.5 +
      (b - Math.floor(b)) * 0.3 +
      (c - Math.floor(c)) * 0.2) *
      2 -
    1
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SPECIES DEFINITIONS — Lake Victoria fish
// ═══════════════════════════════════════════════════════════════════════
type Species = "tilapia" | "nile_perch" | "catfish";
type Personality = "curious" | "timid" | "neutral";

interface SpeciesProfile {
  bodyColor: string; // fill color
  bodyColorAlt: string; // gradient secondary
  finColor: string; // fin tint
  segments: number; // spine segments
  bodyWidthRatio: number; // width relative to length (0-1)
  tailRatio: number; // tail fork size relative to body
  hasBarbels: boolean; // catfish whiskers
  hasStripes: boolean; // tilapia striping
  minSize: number;
  maxSize: number;
  baseSpeed: number;
  turnRate: number;
  preferredDepth: [number, number]; // normalized y range (0=top, 1=bottom)
  personality: Personality;
}

const SPECIES: Record<Species, SpeciesProfile> = {
  tilapia: {
    bodyColor: "rgba(220,235,210,0.95)",
    bodyColorAlt: "rgba(190,210,180,0.85)",
    finColor: "rgba(200,220,190,0.7)",
    segments: 8,
    bodyWidthRatio: 0.38,
    tailRatio: 0.3,
    hasBarbels: false,
    hasStripes: true,
    minSize: 30,
    maxSize: 50,
    baseSpeed: 0.5,
    turnRate: 0.035,
    preferredDepth: [0.25, 0.75],
    personality: "neutral",
  },
  nile_perch: {
    bodyColor: "rgba(210,220,235,0.95)",
    bodyColorAlt: "rgba(180,195,215,0.85)",
    finColor: "rgba(190,205,225,0.65)",
    segments: 10,
    bodyWidthRatio: 0.3,
    tailRatio: 0.35,
    hasBarbels: false,
    hasStripes: false,
    minSize: 55,
    maxSize: 80,
    baseSpeed: 0.35,
    turnRate: 0.02,
    preferredDepth: [0.3, 0.7],
    personality: "curious",
  },
  catfish: {
    bodyColor: "rgba(180,170,160,0.9)",
    bodyColorAlt: "rgba(150,140,130,0.8)",
    finColor: "rgba(170,160,150,0.6)",
    segments: 9,
    bodyWidthRatio: 0.25,
    tailRatio: 0.25,
    hasBarbels: true,
    hasStripes: false,
    minSize: 40,
    maxSize: 65,
    baseSpeed: 0.3,
    turnRate: 0.025,
    preferredDepth: [0.6, 0.9],
    personality: "timid",
  },
};

// ═══════════════════════════════════════════════════════════════════════
// POPULATION — Who lives in this stretch of water
// ═══════════════════════════════════════════════════════════════════════
interface PopulationEntry {
  species: Species;
  juvenile?: boolean; // 0.45–0.6× adult size
  school?: number; // fish sharing a school id get boids-lite cohesion
}

const POPULATION: PopulationEntry[] = [
  { species: "tilapia", school: 0 },
  { species: "tilapia", school: 0 },
  { species: "tilapia", school: 0 },
  { species: "tilapia", school: 0 },
  { species: "tilapia", school: 0, juvenile: true },
  { species: "tilapia", school: 0, juvenile: true },
  { species: "tilapia", school: 0, juvenile: true },
  { species: "nile_perch" },
  { species: "nile_perch" },
  { species: "catfish" },
  { species: "catfish" },
];

// ═══════════════════════════════════════════════════════════════════════
// FISH STATE — Each fish instance
// ═══════════════════════════════════════════════════════════════════════
interface FishState {
  species: Species;
  profile: SpeciesProfile;
  // Segmented spine (positions)
  spine: { x: number; y: number }[];
  // Physics
  angle: number;
  speed: number;
  targetSpeed: number;
  vx: number;
  vy: number;
  size: number;
  depth: number; // 0-1, affects rendering order, opacity, scale
  // Depth-graded colors (precomputed at creation — ctx.filter is too slow
  // on low-end hardware, so distant fish are tinted toward teal up front)
  bodyColor: string;
  bodyColorAlt: string;
  finColor: string;
  // Behavior
  behavior: "cruise" | "dart" | "pause" | "turn" | "flee" | "approach" | "feed";
  behaviorTimer: number;
  behaviorDuration: number;
  personality: Personality;
  schoolId: number | null;
  // Noise seeds
  noiseX: number;
  noiseY: number;
  // Animation
  tailPhase: number;
  finPhase: number;
  // Mouse reaction
  mouseAware: boolean;
  mouseReactionCooldown: number;
  // Stuck detection
  stuckTimer: number;
  // Sprite rendering (photo fish; falls back to the vector path if unloaded)
  facing: 1 | -1; // horizontal flip, with hysteresis to avoid flicker
  depthBucket: number; // index into the pre-tinted sprite copies
  spriteAlpha: number; // near-opaque so photo fish read against the dark water
}

// ═══════════════════════════════════════════════════════════════════════
// PARTICLES — Floating plankton / sediment
// ═══════════════════════════════════════════════════════════════════════
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
}

// ═══════════════════════════════════════════════════════════════════════
// PELLETS — Sinking feed (auto events + click-to-feed)
// ═══════════════════════════════════════════════════════════════════════
interface Pellet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  eaten: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// RIPPLES — One-shot expanding ring where feed hits the water
// ═══════════════════════════════════════════════════════════════════════
interface Ripple {
  x: number;
  y: number;
  age: number; // ms
}

const RIPPLE_MAX_AGE = 400;

// ═══════════════════════════════════════════════════════════════════════
// BUBBLES — Rising air, faster than plankton, wobbling and growing
// ═══════════════════════════════════════════════════════════════════════
interface Bubble {
  anchorX: number;
  y: number;
  vy: number;
  baseSize: number;
  wobblePhase: number;
  wobbleAmp: number;
  wobbleSpeed: number;
  alpha: number;
  transient: boolean; // feed-puff bubbles die out; ambient ones recycle
  ttl: number; // ms, transient only
}

// ═══════════════════════════════════════════════════════════════════════
// CREATION
// ═══════════════════════════════════════════════════════════════════════

// Mix an rgba() color toward deep-water teal. Distant fish (low depth) get
// more tint, which reads as underwater haze without any per-frame cost.
function tintTowardTeal(rgba: string, t: number): string {
  const m = rgba.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/,
  );
  if (!m) return rgba;
  const r = Math.round(parseFloat(m[1]) * (1 - t) + 45 * t);
  const g = Math.round(parseFloat(m[2]) * (1 - t) + 120 * t);
  const b = Math.round(parseFloat(m[3]) * (1 - t) + 125 * t);
  const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
  return `rgba(${r},${g},${b},${a})`;
}

function createFish(w: number, h: number, idx: number): FishState {
  const entry = POPULATION[idx % POPULATION.length];
  const sp = entry.species;
  const profile = SPECIES[sp];
  let size =
    profile.minSize + Math.random() * (profile.maxSize - profile.minSize);
  if (entry.juvenile) size *= 0.45 + Math.random() * 0.15;
  const depth =
    profile.preferredDepth[0] +
    Math.random() * (profile.preferredDepth[1] - profile.preferredDepth[0]);
  const startX = Math.random() * w;
  const startY = h * depth;
  const angle = Math.random() * Math.PI * 2;

  // Initialize spine segments along the starting angle
  const spine: { x: number; y: number }[] = [];
  for (let i = 0; i < profile.segments; i++) {
    spine.push({
      x: startX - Math.cos(angle) * i * (size / profile.segments),
      y: startY - Math.sin(angle) * i * (size / profile.segments),
    });
  }

  // Vary personality slightly from species default
  const personalityRoll = Math.random();
  let personality = profile.personality;
  if (personalityRoll > 0.7) personality = "curious";
  else if (personalityRoll > 0.4) personality = "neutral";
  else if (personalityRoll < 0.15) personality = "timid";

  const tealT = (1 - depth) * 0.5;
  return {
    species: sp,
    profile,
    spine,
    angle,
    speed: profile.baseSpeed,
    targetSpeed: profile.baseSpeed,
    vx: Math.cos(angle) * profile.baseSpeed,
    vy: Math.sin(angle) * profile.baseSpeed,
    size,
    depth,
    bodyColor: tintTowardTeal(profile.bodyColor, tealT),
    bodyColorAlt: tintTowardTeal(profile.bodyColorAlt, tealT),
    finColor: tintTowardTeal(profile.finColor, tealT),
    behavior: "cruise",
    behaviorTimer: 0,
    behaviorDuration: 200 + Math.random() * 400,
    personality,
    schoolId: entry.school ?? null,
    noiseX: idx * 137 + Math.random() * 500,
    noiseY: idx * 251 + Math.random() * 500,
    tailPhase: Math.random() * Math.PI * 2,
    finPhase: Math.random() * Math.PI * 2,
    mouseAware: false,
    mouseReactionCooldown: 0,
    stuckTimer: 0,
    facing: Math.cos(angle) >= 0 ? 1 : -1,
    depthBucket: Math.min(
      SPRITE_DEPTH_BUCKETS - 1,
      Math.floor((1 - depth) * SPRITE_DEPTH_BUCKETS),
    ),
    spriteAlpha: 0.75 + depth * 0.25,
  };
}

function createParticle(w: number, h: number): Particle {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.15,
    vy: -0.05 - Math.random() * 0.1,
    size: 1 + Math.random() * 2,
    alpha: 0.1 + Math.random() * 0.2,
    life: 0,
    maxLife: 500 + Math.random() * 1000,
  };
}

function createBubble(w: number, h: number): Bubble {
  return {
    anchorX: Math.random() * w,
    y: Math.random() * h,
    vy: -0.35 - Math.random() * 0.35, // noticeably faster than plankton drift
    baseSize: 1.2 + Math.random() * 1.8,
    wobblePhase: Math.random() * Math.PI * 2,
    wobbleAmp: 2 + Math.random() * 3,
    wobbleSpeed: 0.6 + Math.random() * 0.8,
    alpha: 0.12 + Math.random() * 0.15,
    transient: false,
    ttl: 0,
  };
}

function spawnPellets(pellets: Pellet[], x: number, y: number, n: number) {
  for (let i = 0; i < n; i++) {
    pellets.push({
      x: x + (Math.random() - 0.5) * 24,
      y: y + (Math.random() - 0.5) * 10,
      vx: (Math.random() - 0.5) * 0.2,
      vy: 0.5 + Math.random() * 0.4, // sinks — fish chase it down
      size: 3 + Math.random(),
      eaten: false,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PHYSICS UPDATE
// ═══════════════════════════════════════════════════════════════════════
const DRAG = 0.988;
const EDGE = 80;
const FEED_RADIUS = 280; // fish notice pellets within this range
const FRENZY_RADIUS = 300; // a feeding schoolmate attracts mates within this
const STARTLE_RADIUS = 160; // timid fish this close to a feed click dart first
const SCHOOL_RADIUS = 90; // tilapia align/cohere with schoolmates within this
const DEPTH_PULL_STRENGTH = 0.00015; // stronger pull toward preferred depth zone
const STUCK_THRESHOLD = 2000; // ms at edge before considering stuck
const STUCK_MARGIN = 50; // px from edge to consider stuck

function updateFish(
  fish: FishState,
  dt: number,
  time: number,
  w: number,
  h: number,
  mouseX: number,
  mouseY: number,
  mouseActive: boolean,
  allFish: FishState[],
  pellets: Pellet[],
  bubbles: Bubble[],
) {
  const { profile } = fish;
  fish.behaviorTimer += dt;

  // ── Mouse proximity check ──
  const head = fish.spine[0];
  const dx = mouseX - head.x;
  const dy = mouseY - head.y;
  const mouseDist = Math.sqrt(dx * dx + dy * dy);
  const mouseRadius = 120 + fish.size;

  if (fish.mouseReactionCooldown > 0) fish.mouseReactionCooldown -= dt;

  // ── Nearest pellet scan — BEFORE the mouse block: food in range suppresses
  // cursor reactions. Without this, the cursor resting at the click point kept
  // every nearby fish mouseAware, and the fish closest to the food were
  // exactly the ones that ignored it. ──
  let targetPellet: Pellet | null = null;
  let targetPelletDist = FEED_RADIUS;
  for (const p of pellets) {
    if (p.eaten) continue;
    const pdx = p.x - head.x;
    const pdy = p.y - head.y;
    const pd = Math.sqrt(pdx * pdx + pdy * pdy);
    if (pd < targetPelletDist) {
      targetPellet = p;
      targetPelletDist = pd;
    }
  }

  if (
    !targetPellet &&
    mouseActive &&
    mouseDist < mouseRadius &&
    fish.mouseReactionCooldown <= 0
  ) {
    fish.mouseAware = true;
    const mouseAngle = Math.atan2(dy, dx);

    if (fish.personality === "timid") {
      // Flee: swim away from cursor
      fish.behavior = "flee";
      fish.behaviorTimer = 0;
      fish.behaviorDuration = 60 + Math.random() * 40;
      fish.targetSpeed = profile.baseSpeed * 2.5;
      // Steer away
      const fleeAngle = mouseAngle + Math.PI;
      fish.angle += angleDiff(fish.angle, fleeAngle) * 0.06;
    } else if (fish.personality === "curious") {
      // Approach: gently follow cursor
      fish.behavior = "approach";
      fish.behaviorTimer = 0;
      fish.behaviorDuration = 100 + Math.random() * 100;
      fish.targetSpeed = profile.baseSpeed * 0.8;
      // Steer toward (with hesitation)
      fish.angle += angleDiff(fish.angle, mouseAngle) * 0.02;
    } else {
      // Neutral: slight avoidance
      if (mouseDist < mouseRadius * 0.5) {
        fish.behavior = "turn";
        fish.behaviorTimer = 0;
        fish.behaviorDuration = 50;
        fish.targetSpeed = profile.baseSpeed * 1.3;
        const fleeAngle = mouseAngle + Math.PI;
        fish.angle += angleDiff(fish.angle, fleeAngle) * 0.03;
      }
    }
  } else {
    fish.mouseAware = false;
  }

  // ── Feeding: steer to the nearest pellet in range and eat it ──
  // Fleeing/darting fish sit this out briefly (startled fish come back for
  // the food once their short dart ends); re-entering feed each frame keeps
  // the FSM parked on it.
  if (targetPellet && fish.behavior !== "flee" && fish.behavior !== "dart") {
    fish.behavior = "feed";
    fish.behaviorTimer = 0;
    fish.behaviorDuration = 60;
    fish.angle +=
      angleDiff(
        fish.angle,
        Math.atan2(targetPellet.y - head.y, targetPellet.x - head.x),
      ) * 0.09;
    // Eat when the pellet is within reach (or within this frame's travel,
    // so fast fish can't orbit-overshoot a pellet forever)
    const reach = Math.max(
      8,
      Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy) * dt * 0.3,
    );
    if (targetPelletDist < reach) {
      targetPellet.eaten = true;
      // Visible lunge as the fish snaps the pellet
      fish.speed += profile.baseSpeed * 0.8;
      // Small bubble puff where the pellet vanished
      const puffs = 2 + Math.floor(Math.random() * 2);
      for (let b = 0; b < puffs; b++) {
        bubbles.push({
          anchorX: targetPellet.x + (Math.random() - 0.5) * 6,
          y: targetPellet.y,
          vy: -0.4 - Math.random() * 0.3,
          baseSize: 0.7 + Math.random() * 0.8,
          wobblePhase: Math.random() * Math.PI * 2,
          wobbleAmp: 1 + Math.random() * 2,
          wobbleSpeed: 1 + Math.random(),
          alpha: 0.3 + Math.random() * 0.2,
          transient: true,
          ttl: 700 + Math.random() * 500,
        });
      }
    }
  } else if (!targetPellet && fish.behavior === "feed") {
    // Food gone — settle back into a cruise
    fish.behavior = "cruise";
    fish.behaviorTimer = 0;
    fish.behaviorDuration = 200 + Math.random() * 300;
  }

  // ── Behavior state machine (when not reacting to mouse) ──
  if (!fish.mouseAware && fish.behaviorTimer > fish.behaviorDuration) {
    fish.behaviorTimer = 0;
    const roll = Math.random();
    if (roll < 0.55) {
      fish.behavior = "cruise";
      fish.behaviorDuration = 300 + Math.random() * 500;
    } else if (roll < 0.73) {
      fish.behavior = "turn";
      fish.behaviorDuration = 80 + Math.random() * 150;
    } else if (roll < 0.88) {
      fish.behavior = "dart";
      fish.behaviorDuration = 25 + Math.random() * 50;
    } else {
      fish.behavior = "pause";
      fish.behaviorDuration = 100 + Math.random() * 250;
    }
  }

  // ── Noise-based wandering ──
  const nt = time * 0.0003;
  const steerNoise = noise(fish.noiseX + nt, fish.noiseY + nt * 0.7);

  let steer = steerNoise * 0.4;
  let tSpeed = profile.baseSpeed;

  switch (fish.behavior) {
    case "cruise":
      tSpeed = profile.baseSpeed;
      break;
    case "turn":
      steer *= 2.8;
      tSpeed = profile.baseSpeed * 0.6;
      break;
    case "dart":
      steer *= 0.2;
      tSpeed = profile.baseSpeed * 2.8;
      break;
    case "pause":
      steer *= 0.4;
      tSpeed = profile.baseSpeed * 0.1;
      break;
    case "flee":
      steer *= 0.3;
      tSpeed = profile.baseSpeed * 2.5;
      break;
    case "approach":
      steer *= 0.5;
      tSpeed = profile.baseSpeed * 0.7;
      break;
    case "feed":
      steer *= 0.2;
      tSpeed = profile.baseSpeed * 1.8;
      break;
  }
  if (!fish.mouseAware) fish.targetSpeed = tSpeed;

  // ── Fish-to-fish: separation (all fish) + schooling census (same school) ──
  let mateCount = 0;
  let mateCx = 0,
    mateCy = 0;
  let mateSin = 0,
    mateCos = 0;
  let feedingMateAngle: number | null = null;
  let feedingMateDist = FRENZY_RADIUS;
  for (const other of allFish) {
    if (other === fish) continue;
    const ox = other.spine[0].x - head.x;
    const oy = other.spine[0].y - head.y;
    const od = Math.sqrt(ox * ox + oy * oy);
    const minDist = (fish.size + other.size) * 0.6;
    if (od < minDist && od > 0) {
      const repelAngle = Math.atan2(-oy, -ox);
      fish.angle += angleDiff(fish.angle, repelAngle) * 0.04;
      fish.targetSpeed = Math.max(fish.targetSpeed, profile.baseSpeed * 1.2);
    }
    if (fish.schoolId !== null && other.schoolId === fish.schoolId) {
      if (od < SCHOOL_RADIUS) {
        mateCount++;
        mateCx += other.spine[0].x;
        mateCy += other.spine[0].y;
        mateSin += Math.sin(other.angle);
        mateCos += Math.cos(other.angle);
      }
      if (other.behavior === "feed" && od < feedingMateDist) {
        feedingMateDist = od;
        feedingMateAngle = Math.atan2(oy, ox);
      }
    }
  }

  // ── Feeding frenzy: a schoolmate on food drags nearby mates toward it even
  // when the pellets are outside their own detection radius. A steering nudge
  // only — no behavior change, so the feed/cruise reset above stays in charge. ──
  if (
    feedingMateAngle !== null &&
    !targetPellet &&
    fish.behavior !== "flee" &&
    fish.behavior !== "dart"
  ) {
    fish.angle += angleDiff(fish.angle, feedingMateAngle) * 0.05;
    fish.targetSpeed = Math.max(fish.targetSpeed, profile.baseSpeed * 1.6);
  }

  // ── Boids-lite schooling: alignment + cohesion nudges, deliberately weak
  // so the behavior FSM (and feeding/fleeing) still dominates ──
  if (
    mateCount > 0 &&
    !fish.mouseAware &&
    fish.behavior !== "feed" &&
    fish.behavior !== "flee"
  ) {
    const avgHeading = Math.atan2(mateSin / mateCount, mateCos / mateCount);
    fish.angle += angleDiff(fish.angle, avgHeading) * 0.02;
    const toCenter = Math.atan2(
      mateCy / mateCount - head.y,
      mateCx / mateCount - head.x,
    );
    fish.angle += angleDiff(fish.angle, toCenter) * 0.012;
  }

  // ── Edge avoidance ──
  if (head.x < EDGE) fish.angle += 0.06 * (1 - head.x / EDGE);
  if (head.x > w - EDGE) fish.angle -= 0.06 * (1 - (w - head.x) / EDGE);
  if (head.y < EDGE * 0.4) fish.angle += 0.08;
  if (head.y > h - EDGE * 0.4) fish.angle -= 0.08;

  // Vertical wrap: fish that swim off top/bottom reappear on opposite side
  // (with a small buffer so the wrap isn't visible)
  const wrapBuffer = fish.size * 2;
  if (head.y < -wrapBuffer) {
    for (const s of fish.spine) s.y += h + wrapBuffer * 2;
  }
  if (head.y > h + wrapBuffer) {
    for (const s of fish.spine) s.y -= h + wrapBuffer * 2;
  }

  // Depth preference pull (stronger, scaled by distance from preferred zone)
  const prefYMin = h * profile.preferredDepth[0];
  const prefYMax = h * profile.preferredDepth[1];
  const prefYCenter = (prefYMin + prefYMax) * 0.5;
  const depthDist = head.y - prefYCenter;
  const depthPull = depthDist * DEPTH_PULL_STRENGTH * dt;
  fish.angle -= depthPull; // negative because positive angle = down

  // Horizontal wrap
  if (head.x < -fish.size * 2) {
    for (const s of fish.spine) s.x += w + fish.size * 4;
  }
  if (head.x > w + fish.size * 2) {
    for (const s of fish.spine) s.x -= w + fish.size * 4;
  }

  // ── Apply steering + physics ──
  if (!fish.mouseAware) fish.angle += steer * profile.turnRate * dt;
  fish.speed += (fish.targetSpeed - fish.speed) * 0.03 * dt;

  fish.vx = fish.vx * DRAG + Math.cos(fish.angle) * fish.speed * 0.08;
  fish.vy = fish.vy * DRAG + Math.sin(fish.angle) * fish.speed * 0.08;

  // ── Update segmented spine (head leads, body follows) ──
  fish.spine[0].x += fish.vx * dt * 0.3;
  fish.spine[0].y += fish.vy * dt * 0.3;

  const segLen = fish.size / fish.profile.segments;
  for (let i = 1; i < fish.spine.length; i++) {
    const prev = fish.spine[i - 1];
    const curr = fish.spine[i];
    const ddx = curr.x - prev.x;
    const ddy = curr.y - prev.y;
    const dd = Math.sqrt(ddx * ddx + ddy * ddy);
    if (dd > segLen) {
      const ratio = segLen / dd;
      curr.x = prev.x + ddx * ratio;
      curr.y = prev.y + ddy * ratio;
    }
  }

  // ── Tail + fin animation ──
  const swimIntensity = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy);
  fish.tailPhase += (3 + swimIntensity * 8) * dt * 0.01;
  fish.finPhase += 2 * dt * 0.01;

  // ── Facing (sprite path): flip only past a clear horizontal heading so
  // near-vertical swimming doesn't flicker the fish left/right ──
  const facingCos = Math.cos(fish.angle);
  if (Math.abs(facingCos) > 0.15) fish.facing = facingCos > 0 ? 1 : -1;
}

// Shortest angle difference
function angleDiff(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ═══════════════════════════════════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════════════════════════════════

function drawLightRays(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
) {
  ctx.save();
  for (let i = 0; i < 4; i++) {
    const x = w * (0.15 + i * 0.22) + Math.sin(time * 0.0003 + i * 2) * 30;
    // Noise-driven flicker, like surface chop modulating the light
    const flicker = 0.75 + noise(i * 13.7, time * 0.0004) * 0.25;
    const grad = ctx.createLinearGradient(x, 0, x + 40, h * 0.7);
    grad.addColorStop(0, `rgba(255,255,255,${0.12 * flicker})`);
    grad.addColorStop(0.5, `rgba(255,255,255,${0.05 * flicker})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x - 15, 0);
    ctx.lineTo(x + 25, 0);
    ctx.lineTo(x + 60 + Math.sin(time * 0.0005 + i) * 20, h * 0.7);
    ctx.lineTo(x - 50 + Math.sin(time * 0.0004 + i) * 15, h * 0.7);
    ctx.closePath();
    ctx.fill();

    // Narrow, brighter core inside the ray
    const core = ctx.createLinearGradient(x, 0, x + 15, h * 0.6);
    core.addColorStop(0, `rgba(255,255,255,${0.1 * flicker})`);
    core.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.moveTo(x - 3, 0);
    ctx.lineTo(x + 8, 0);
    ctx.lineTo(x + 32 + Math.sin(time * 0.0005 + i) * 15, h * 0.6);
    ctx.lineTo(x - 16 + Math.sin(time * 0.0004 + i) * 11, h * 0.6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  dt: number,
  w: number,
  h: number,
) {
  for (const p of particles) {
    p.x += p.vx * dt * 0.1;
    p.y += p.vy * dt * 0.1;
    p.life += dt;
    if (p.life > p.maxLife || p.y < -10) {
      p.x = Math.random() * w;
      p.y = h + 5;
      p.life = 0;
    }
    const fade = 1 - p.life / p.maxLife;
    ctx.globalAlpha = p.alpha * fade;
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPellets(
  ctx: CanvasRenderingContext2D,
  pellets: Pellet[],
  dt: number,
  h: number,
) {
  for (let i = pellets.length - 1; i >= 0; i--) {
    const p = pellets[i];
    p.x += p.vx * dt * 0.1;
    p.y += p.vy * dt * 0.1;
    if (p.eaten) {
      // Shrink out over ~100ms instead of vanishing in one frame — the eat
      // reads as a bite, not a blink. The feed scan skips eaten pellets.
      p.size *= Math.pow(0.5, dt / 40);
      if (p.size < 0.5) {
        pellets.splice(i, 1);
        continue;
      }
    } else if (p.y > h + 10) {
      pellets.splice(i, 1);
      continue;
    }
    ctx.fillStyle = "rgba(255,196,110,0.95)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    // Lighter core so pellets read at a glance against the dark water
    ctx.fillStyle = "rgba(255,232,178,1)";
    ctx.beginPath();
    ctx.arc(
      p.x - p.size * 0.2,
      p.y - p.size * 0.2,
      p.size * 0.45,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function drawRipples(
  ctx: CanvasRenderingContext2D,
  ripples: Ripple[],
  dt: number,
) {
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.age += dt;
    if (r.age >= RIPPLE_MAX_AGE) {
      ripples.splice(i, 1);
      continue;
    }
    const t = r.age / RIPPLE_MAX_AGE;
    const ease = 1 - (1 - t) * (1 - t);
    ctx.globalAlpha = 0.55 * (1 - t);
    ctx.strokeStyle = "rgba(255,220,170,1)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(r.x, r.y, 6 + ease * 42, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawBubbles(
  ctx: CanvasRenderingContext2D,
  bubbles: Bubble[],
  dt: number,
  w: number,
  h: number,
) {
  ctx.strokeStyle = "rgba(235,245,255,0.9)";
  ctx.lineWidth = 1;
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    b.y += b.vy * dt * 0.1;
    b.wobblePhase += b.wobbleSpeed * dt * 0.004;
    if (b.transient) {
      b.ttl -= dt;
      if (b.ttl <= 0 || b.y < -5) {
        bubbles.splice(i, 1);
        continue;
      }
    } else if (b.y < -5) {
      // Ambient bubbles recycle from the bottom
      b.y = h + 5;
      b.anchorX = Math.random() * w;
    }
    const x = b.anchorX + Math.sin(b.wobblePhase) * b.wobbleAmp;
    const r = b.baseSize * (1 + Math.max(0, 1 - b.y / h) * 0.4); // grows as it rises
    ctx.globalAlpha = b.transient
      ? b.alpha * Math.min(1, b.ttl / 400)
      : b.alpha;
    ctx.beginPath();
    ctx.arc(x, b.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawFish(ctx: CanvasRenderingContext2D, fish: FishState) {
  const { spine, profile, size, depth, tailPhase, finPhase } = fish;
  if (spine.length < 3) return;

  // Global alpha from depth (farther = fainter, but visible over dark overlays)
  const baseAlpha = 0.45 + depth * 0.45;
  const scale = 0.65 + depth * 0.35;

  ctx.save();

  // ── Build body outline from spine ──
  const segLen = size / profile.segments;
  const half = profile.bodyWidthRatio * size * scale;

  // Calculate widths per segment (tapers at head and tail)
  const widths: number[] = [];
  const n = spine.length;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1); // 0 = head, 1 = tail
    // Rounded body profile: wider in middle, tapers at both ends
    let w: number;
    if (t < 0.15)
      w = half * (0.5 + (t / 0.15) * 0.5); // head taper
    else if (t < 0.5)
      w = half * (1.0 + (t - 0.15) * 0.15); // body widens
    else w = half * Math.max(0.08, 1.0 - (t - 0.5) * 1.7); // tail taper
    // Nile perch is chunkier in the front
    if (fish.species === "nile_perch" && t < 0.4) w *= 1.15;
    // Catfish is more uniform
    if (fish.species === "catfish") w *= 0.85;
    widths.push(w * scale);
  }

  // ── Apply tail wag to spine segments (wave motion) ──
  const headAngle = Math.atan2(
    spine[1].y - spine[0].y,
    spine[1].x - spine[0].x,
  );
  const perpDir = headAngle + Math.PI / 2;
  const waveSpine = spine.map((s, i) => {
    const t = i / (n - 1);
    const wag = Math.sin(tailPhase + t * 3.5) * t * t * segLen * 0.6 * scale;
    return {
      x: s.x + Math.cos(perpDir) * wag,
      y: s.y + Math.sin(perpDir) * wag,
    };
  });

  // ── Draw body (filled outline from segments) ──
  ctx.globalAlpha = baseAlpha;

  // Top edge (head to tail)
  const topPoints: { x: number; y: number }[] = [];
  const botPoints: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const s = waveSpine[i];
    let perpAngle: number;
    if (i === 0)
      perpAngle =
        Math.atan2(waveSpine[1].y - s.y, waveSpine[1].x - s.x) + Math.PI / 2;
    else if (i === n - 1)
      perpAngle =
        Math.atan2(s.y - waveSpine[i - 1].y, s.x - waveSpine[i - 1].x) +
        Math.PI / 2;
    else
      perpAngle =
        Math.atan2(
          waveSpine[i + 1].y - waveSpine[i - 1].y,
          waveSpine[i + 1].x - waveSpine[i - 1].x,
        ) +
        Math.PI / 2;

    topPoints.push({
      x: s.x + Math.cos(perpAngle) * widths[i],
      y: s.y + Math.sin(perpAngle) * widths[i],
    });
    botPoints.push({
      x: s.x - Math.cos(perpAngle) * widths[i],
      y: s.y - Math.sin(perpAngle) * widths[i],
    });
  }

  // Fill body (depth-graded color precomputed at creation)
  ctx.fillStyle = fish.bodyColor;
  ctx.beginPath();
  ctx.moveTo(topPoints[0].x, topPoints[0].y);
  for (let i = 1; i < topPoints.length; i++)
    ctx.lineTo(topPoints[i].x, topPoints[i].y);
  for (let i = botPoints.length - 1; i >= 0; i--)
    ctx.lineTo(botPoints[i].x, botPoints[i].y);
  ctx.closePath();
  ctx.fill();

  // Darker belly gradient
  ctx.globalAlpha = baseAlpha * 0.4;
  ctx.fillStyle = fish.bodyColorAlt;
  ctx.beginPath();
  const mid = Math.floor(n * 0.5);
  ctx.moveTo(waveSpine[0].x, waveSpine[0].y);
  for (let i = 0; i < botPoints.length; i++)
    ctx.lineTo(botPoints[i].x, botPoints[i].y);
  for (let i = topPoints.length - 1; i >= mid; i--)
    ctx.lineTo(topPoints[i].x, topPoints[i].y);
  ctx.closePath();
  ctx.fill();

  // ── Scale shimmer: specular stroke along the upper flank, strongest when
  // that flank faces the light from the surface ──
  const upFacing = Math.max(0, -Math.sin(headAngle + Math.PI / 2));
  ctx.globalAlpha = baseAlpha * (0.12 + 0.3 * upFacing);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.2 * scale;
  const shimmerStart = Math.max(1, Math.floor(n * 0.12));
  const shimmerEnd = Math.min(n - 2, Math.ceil(n * 0.7));
  ctx.beginPath();
  ctx.moveTo(topPoints[shimmerStart].x, topPoints[shimmerStart].y);
  for (let i = shimmerStart + 1; i <= shimmerEnd; i++)
    ctx.lineTo(topPoints[i].x, topPoints[i].y);
  ctx.stroke();

  // ── Stripes (tilapia) ──
  if (profile.hasStripes) {
    ctx.globalAlpha = baseAlpha * 0.25;
    ctx.strokeStyle = "rgba(60,80,50,0.5)";
    ctx.lineWidth = 1 * scale;
    for (let i = 2; i < n - 2; i += 2) {
      ctx.beginPath();
      ctx.moveTo(topPoints[i].x, topPoints[i].y);
      ctx.lineTo(botPoints[i].x, botPoints[i].y);
      ctx.stroke();
    }
  }

  // ── Tail fin ──
  ctx.globalAlpha = baseAlpha * 0.8;
  ctx.fillStyle = fish.finColor;
  const tailSeg = waveSpine[n - 1];
  const preTail = waveSpine[n - 2];
  const tailAngle = Math.atan2(tailSeg.y - preTail.y, tailSeg.x - preTail.x);
  const tailWag = Math.sin(tailPhase) * 0.3;
  const tSize = size * profile.tailRatio * scale;
  ctx.save();
  ctx.translate(tailSeg.x, tailSeg.y);
  ctx.rotate(tailAngle + Math.PI + tailWag);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(tSize * 0.5, -tSize * 0.7, tSize, -tSize * 0.5);
  ctx.quadraticCurveTo(tSize * 0.6, 0, tSize, tSize * 0.5);
  ctx.quadraticCurveTo(tSize * 0.5, tSize * 0.7, 0, 0);
  ctx.fill();
  ctx.restore();

  // ── Dorsal fin ──
  ctx.globalAlpha = baseAlpha * 0.6;
  ctx.fillStyle = fish.finColor;
  const dorsalStart = Math.floor(n * 0.2);
  const dorsalEnd = Math.floor(n * 0.55);
  ctx.beginPath();
  ctx.moveTo(topPoints[dorsalStart].x, topPoints[dorsalStart].y);
  const dorsalMid = Math.floor((dorsalStart + dorsalEnd) / 2);
  const dorsalHeight = size * 0.2 * scale;
  const dorsalPeak = topPoints[dorsalMid];
  const dorsalAngle =
    Math.atan2(
      topPoints[dorsalEnd].y - topPoints[dorsalStart].y,
      topPoints[dorsalEnd].x - topPoints[dorsalStart].x,
    ) -
    Math.PI / 2;
  ctx.quadraticCurveTo(
    dorsalPeak.x + Math.cos(dorsalAngle) * dorsalHeight,
    dorsalPeak.y + Math.sin(dorsalAngle) * dorsalHeight,
    topPoints[dorsalEnd].x,
    topPoints[dorsalEnd].y,
  );
  ctx.fill();

  // ── Pectoral fin (animated) ──
  ctx.globalAlpha = baseAlpha * 0.4;
  const pectoralIdx = Math.floor(n * 0.25);
  const pf = botPoints[pectoralIdx];
  const finWag = Math.sin(finPhase) * 0.2;
  ctx.save();
  ctx.translate(pf.x, pf.y);
  ctx.rotate(headAngle + Math.PI * 0.6 + finWag);
  ctx.beginPath();
  ctx.ellipse(
    0,
    0,
    size * 0.12 * scale,
    size * 0.04 * scale,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  // ── Barbels (catfish only) ──
  if (profile.hasBarbels) {
    ctx.globalAlpha = baseAlpha * 0.5;
    ctx.strokeStyle = fish.bodyColor;
    ctx.lineWidth = 1 * scale;
    const headPt = waveSpine[0];
    for (let b = 0; b < 3; b++) {
      const bAngle =
        headAngle + (b - 1) * 0.3 + Math.sin(tailPhase * 0.5 + b) * 0.1;
      ctx.beginPath();
      ctx.moveTo(
        headPt.x + Math.cos(headAngle) * size * 0.1 * scale,
        headPt.y + Math.sin(headAngle) * size * 0.1 * scale,
      );
      ctx.quadraticCurveTo(
        headPt.x + Math.cos(bAngle) * size * 0.25 * scale,
        headPt.y + Math.sin(bAngle) * size * 0.25 * scale,
        headPt.x + Math.cos(bAngle) * size * 0.35 * scale,
        headPt.y +
          Math.sin(bAngle) * size * 0.35 * scale +
          Math.sin(tailPhase + b) * 3,
      );
      ctx.stroke();
    }
  }

  // ── Eye ──
  ctx.globalAlpha = baseAlpha * 2;
  const eyeIdx = 0;
  const eyePt = waveSpine[eyeIdx];
  const eyeOff = size * 0.08 * scale;
  const eyeAngle = Math.atan2(
    waveSpine[1].y - eyePt.y,
    waveSpine[1].x - eyePt.x,
  );
  const ex =
    eyePt.x +
    Math.cos(eyeAngle) * size * 0.06 * scale +
    Math.cos(eyeAngle + Math.PI / 2) * eyeOff * 0.3;
  const ey =
    eyePt.y +
    Math.sin(eyeAngle) * size * 0.06 * scale +
    Math.sin(eyeAngle + Math.PI / 2) * eyeOff * 0.3;
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.arc(ex, ey, size * 0.025 * scale, 0, Math.PI * 2);
  ctx.fill();
  // Pupil
  ctx.globalAlpha = baseAlpha * 2.5;
  ctx.fillStyle = "rgba(20,20,20,0.8)";
  ctx.beginPath();
  ctx.arc(
    ex + Math.cos(eyeAngle) * size * 0.008,
    ey + Math.sin(eyeAngle) * size * 0.008,
    size * 0.013 * scale,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════
// SPRITE RENDERING — photo-real fish drawn as spine-bent bitmap slices
//
// Each species has one head-right lateral cutout (frontend/public/fish/*.webp).
// At load we build a few depth-tinted copies (offscreen canvases) so distant
// fish read as hazier without any per-frame ctx.filter cost. The sprite is
// sliced into head/mid/tail source-rects at draw time; each slice is anchored
// to the animated spine so the body still bends and the tail wags. If a sprite
// fails to load, drawFishAuto falls back to the vector drawFish above.
// ═══════════════════════════════════════════════════════════════════════
const SPRITE_DEPTH_BUCKETS = 3;
const SPRITE_TEAL_MAX = 0.2; // far weaker than the vector path's 0.5 — keep fish vivid
const SPRITE_LEN = 1.28; // drawn length as a multiple of `size` (sprite includes tail fin)
const SPRITE_WAG = 0.5; // spine wag amplitude (vector body uses ~0.6)

const FISH_SPRITE_URLS: Record<Species, string> = {
  tilapia: "/fish/tilapia.webp",
  nile_perch: "/fish/nile_perch.webp",
  catfish: "/fish/catfish.webp",
};

// 3 slices as [srcStart, srcEnd] fractions of the sprite width, each anchored
// between two spine fractions [a, b]. ~6% overlap hides the seams. Head-right
// sprite, so slice 0 (left of image) is the tail. Drawn tail→head.
const SPRITE_SLICES = [
  { s0: 0.62, s1: 1.0, a: 0.54, b: 1.0 }, // tail
  { s0: 0.3, s1: 0.68, a: 0.28, b: 0.6 }, // mid
  { s0: 0.0, s1: 0.36, a: 0.0, b: 0.34 }, // head
];

interface SpriteData {
  buckets: HTMLCanvasElement[]; // one pre-tinted copy per depth bucket
  w: number;
  h: number;
  ready: boolean;
}

// Module-level so sprites survive React remounts (dev StrictMode double-mount)
const spriteCache: Partial<Record<Species, SpriteData>> = {};
let spritesRequested = false;

// Reused across every sprite draw — fish render one at a time, so a single
// scratch buffer means zero per-frame allocation on the sprite path.
const MAX_SEGMENTS = Math.max(...Object.values(SPECIES).map((s) => s.segments));
const waveScratch = Array.from({ length: MAX_SEGMENTS }, () => ({
  x: 0,
  y: 0,
}));

function makeTintedSprite(
  img: HTMLImageElement,
  tealT: number,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const cx = c.getContext("2d")!;
  cx.drawImage(img, 0, 0);
  if (tealT > 0) {
    // Mix the fish pixels toward deep-water teal, confined to the sprite's
    // own alpha (source-atop) — same teal as the vector path, capped low.
    cx.globalCompositeOperation = "source-atop";
    cx.fillStyle = `rgba(45,120,125,${tealT})`;
    cx.fillRect(0, 0, c.width, c.height);
    cx.globalCompositeOperation = "source-over";
  }
  return c;
}

function loadFishSprites(onReady: () => void) {
  if (spritesRequested) return;
  spritesRequested = true;
  (Object.keys(FISH_SPRITE_URLS) as Species[]).forEach((sp) => {
    const img = new Image();
    img.onload = () => {
      const buckets: HTMLCanvasElement[] = [];
      for (let b = 0; b < SPRITE_DEPTH_BUCKETS; b++) {
        // bucket 0 = shallowest (least tint) … deepest = most tint
        const tealT = (b / (SPRITE_DEPTH_BUCKETS - 1)) * SPRITE_TEAL_MAX;
        buckets.push(makeTintedSprite(img, tealT));
      }
      spriteCache[sp] = {
        buckets,
        w: img.naturalWidth,
        h: img.naturalHeight,
        ready: true,
      };
      onReady();
    };
    img.onerror = () => {
      /* leave unset → permanent vector fallback for this species */
    };
    img.src = FISH_SPRITE_URLS[sp];
  });
}

function drawFishSprite(
  ctx: CanvasRenderingContext2D,
  fish: FishState,
  sd: SpriteData,
) {
  const { spine, size, depth } = fish;
  const n = spine.length;
  if (n < 3) return;
  const scale = 0.65 + depth * 0.35;

  // Wag the spine into the scratch buffer (same wave the vector body uses)
  const segLen = size / fish.profile.segments;
  const headAngle = Math.atan2(
    spine[1].y - spine[0].y,
    spine[1].x - spine[0].x,
  );
  const perp = headAngle + Math.PI / 2;
  const cosP = Math.cos(perp),
    sinP = Math.sin(perp);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const wag =
      Math.sin(fish.tailPhase + t * 3.5) * t * t * segLen * SPRITE_WAG * scale;
    waveScratch[i].x = spine[i].x + cosP * wag;
    waveScratch[i].y = spine[i].y + sinP * wag;
  }

  // Grounding shadow beneath the fish — cheap depth cue
  const mid = waveScratch[n >> 1];
  ctx.globalAlpha = 0.12 * depth;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(
    mid.x,
    mid.y + size * 0.35 * scale,
    size * 0.55 * scale,
    size * 0.12 * scale,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  const bucket = sd.buckets[Math.min(sd.buckets.length - 1, fish.depthBucket)];
  const L = size * scale * SPRITE_LEN;
  const dh = L * (sd.h / sd.w);
  ctx.globalAlpha = fish.spriteAlpha;
  for (const sl of SPRITE_SLICES) {
    const pa = waveScratch[Math.round(sl.a * (n - 1))]; // toward tail
    const pb = waveScratch[Math.round(sl.b * (n - 1))]; // toward head
    const theta = Math.atan2(pb.y - pa.y, pb.x - pa.x); // local head-ward direction
    const dw = L * (sl.s1 - sl.s0);
    ctx.save();
    ctx.translate((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
    ctx.rotate(theta);
    ctx.scale(1, fish.facing); // flip about the long axis so the dorsal stays up
    ctx.drawImage(
      bucket,
      sl.s0 * sd.w,
      0,
      (sl.s1 - sl.s0) * sd.w,
      sd.h,
      -dw / 2,
      -dh / 2,
      dw,
      dh,
    );
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// Draw a fish as a sprite if its species bitmap is loaded, else vector.
function drawFishAuto(ctx: CanvasRenderingContext2D, fish: FishState) {
  const sd = spriteCache[fish.species];
  if (sd && sd.ready) drawFishSprite(ctx, fish, sd);
  else drawFish(ctx, fish);
}

// ═══════════════════════════════════════════════════════════════════════
// REACT COMPONENT
// ═══════════════════════════════════════════════════════════════════════
const NUM_FISH = POPULATION.length;
const NUM_PARTICLES = 25;
const NUM_BUBBLES = 8;
const FRAME_MIN_MS = 33.3; // ~30fps cap — ample for an ambient background
const REDUCED_MOTION_WARMUP = 120; // sim ticks before the single static frame
const FEED_EVERY_MIN_MS = 25_000; // autonomous feed event: 25–45s apart
const FEED_EVERY_VAR_MS = 20_000;

export default function FishCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fishRef = useRef<FishState[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const pelletsRef = useRef<Pellet[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const bubblesRef = useRef<Bubble[]>([]);
  const nextFeedRef = useRef<number>(0);
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const mouseRef = useRef({ x: -1000, y: -1000, active: false });
  const sizeRef = useRef({ w: 0, h: 0 });
  const runningRef = useRef(false);

  const animate = useCallback((timestamp: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Cap at ~30fps — the sim is dt-scaled, so motion speed is unchanged
    if (timestamp - lastTimeRef.current < FRAME_MIN_MS) {
      animRef.current = requestAnimationFrame(animate);
      return;
    }

    const dt = Math.min(timestamp - (lastTimeRef.current || timestamp), 50);
    lastTimeRef.current = timestamp;

    const { w, h } = sizeRef.current;
    ctx.clearRect(0, 0, w, h);

    // ── Autonomous feed event (randomized 25–45s, driven off sim time so it
    // pauses with the loop) ──
    if (timestamp >= nextFeedRef.current) {
      if (nextFeedRef.current !== 0) {
        const fx = w * (0.2 + Math.random() * 0.6);
        spawnPellets(
          pelletsRef.current,
          fx,
          12,
          4 + Math.floor(Math.random() * 3),
        );
        ripplesRef.current.push({ x: fx, y: 12, age: 0 });
      }
      nextFeedRef.current =
        timestamp + FEED_EVERY_MIN_MS + Math.random() * FEED_EVERY_VAR_MS;
    }

    // ── Environment ──
    drawLightRays(ctx, w, h, timestamp);
    drawParticles(ctx, particlesRef.current, dt, w, h);
    drawPellets(ctx, pelletsRef.current, dt, h);
    drawRipples(ctx, ripplesRef.current, dt);

    // ── Update + draw fish (depth-sorted once at creation; depth never mutates) ──
    const { x: mx, y: my, active: mActive } = mouseRef.current;
    for (const fish of fishRef.current) {
      updateFish(
        fish,
        dt,
        timestamp,
        w,
        h,
        mx,
        my,
        mActive,
        fishRef.current,
        pelletsRef.current,
        bubblesRef.current,
      );
      drawFishAuto(ctx, fish);
    }

    // ── Stuck-fish recovery: respawn fish stuck at top/bottom edges ──
    // A fish is "stuck" if its head has been within STUCK_MARGIN of top/bottom
    // for more than STUCK_THRESHOLD ms. We respawn it at a random position
    // within its preferred depth zone.
    for (const fish of fishRef.current) {
      const head = fish.spine[0];
      const atTop = head.y < STUCK_MARGIN;
      const atBottom = head.y > h - STUCK_MARGIN;
      if (atTop || atBottom) {
        fish.stuckTimer = (fish.stuckTimer ?? 0) + dt;
        if (fish.stuckTimer > STUCK_THRESHOLD) {
          // Respawn at a random position in preferred depth zone
          const profile = fish.profile;
          const newDepth =
            profile.preferredDepth[0] +
            Math.random() * (profile.preferredDepth[1] - profile.preferredDepth[0]);
          const newX = Math.random() * w;
          const newY = h * newDepth;
          const angle = Math.random() * Math.PI * 2;
          fish.stuckTimer = 0;
          fish.behavior = "cruise";
          fish.behaviorTimer = 0;
          fish.behaviorDuration = 200 + Math.random() * 400;
          fish.targetSpeed = profile.baseSpeed;
          fish.speed = profile.baseSpeed;
          fish.angle = angle;
          fish.vx = Math.cos(angle) * profile.baseSpeed;
          fish.vy = Math.sin(angle) * profile.baseSpeed;
          for (let i = 0; i < fish.spine.length; i++) {
            fish.spine[i].x = newX - Math.cos(angle) * i * (fish.size / fish.profile.segments);
            fish.spine[i].y = newY - Math.sin(angle) * i * (fish.size / fish.profile.segments);
          }
        }
      } else {
        fish.stuckTimer = 0;
      }
    }

    // Bubbles drift up in front of the fish
    drawBubbles(ctx, bubblesRef.current, dt, w, h);

    animRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const startLoop = () => {
      if (runningRef.current || reducedMotion) return;
      if (sizeRef.current.w === 0 || sizeRef.current.h === 0) return;
      runningRef.current = true;
      lastTimeRef.current = 0; // reset so pause/resume doesn't produce a dt spike
      animRef.current = requestAnimationFrame(animate);
    };
    const stopLoop = () => {
      if (!runningRef.current) return;
      runningRef.current = false;
      cancelAnimationFrame(animRef.current);
    };

    // Reduced motion: warm the sim up so poses look natural, then draw a single
    // static frame and never start the loop. Warmup runs once; the draw can be
    // re-run when sprites finish loading (vector frame first, sprite frame next).
    let warmed = false;
    const warmupSim = () => {
      if (warmed) return;
      warmed = true;
      const { w, h } = sizeRef.current;
      for (let i = 0; i < REDUCED_MOTION_WARMUP; i++) {
        for (const fish of fishRef.current) {
          updateFish(
            fish,
            16.7,
            i * 16.7,
            w,
            h,
            -1000,
            -1000,
            false,
            fishRef.current,
            pelletsRef.current,
            bubblesRef.current,
          );
        }
      }
    };
    const drawStaticScene = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { w, h } = sizeRef.current;
      ctx.clearRect(0, 0, w, h);
      drawLightRays(ctx, w, h, 0);
      drawParticles(ctx, particlesRef.current, 0, w, h);
      for (const fish of fishRef.current) drawFishAuto(ctx, fish);
      drawBubbles(ctx, bubblesRef.current, 0, w, h);
    };
    const renderStaticFrame = () => {
      warmupSim();
      drawStaticScene();
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = parent.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      // The hero panel is `hidden lg:block`, so on mobile the parent rect is
      // 0×0 — don't burn battery simming an invisible canvas. A later resize
      // with real dimensions starts the loop.
      if (w === 0 || h === 0) {
        sizeRef.current = { w: 0, h: 0 };
        stopLoop();
        return;
      }

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w, h };

      if (fishRef.current.length === 0) {
        fishRef.current = Array.from({ length: NUM_FISH }, (_, i) =>
          createFish(w, h, i),
        );
        // Depth never changes after creation, so sorting once here replaces
        // the old per-frame sort in animate()
        fishRef.current.sort((a, b) => a.depth - b.depth);
        particlesRef.current = Array.from({ length: NUM_PARTICLES }, () =>
          createParticle(w, h),
        );
        bubblesRef.current = Array.from({ length: NUM_BUBBLES }, () =>
          createBubble(w, h),
        );
      }

      if (reducedMotion) renderStaticFrame();
      else startLoop();
    };

    const handleMouse = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        active: true,
      };
    };
    const handleMouseLeave = () => {
      mouseRef.current.active = false;
    };
    const handleClick = (e: MouseEvent) => {
      // Click-to-feed: a click tosses feed pellets into the water (this is an
      // aquaculture app, after all). Timid fish close to the splash startle
      // first, then circle back for the food once their brief dart ends.
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      spawnPellets(
        pelletsRef.current,
        cx,
        cy,
        4 + Math.floor(Math.random() * 3),
      );
      ripplesRef.current.push({ x: cx, y: cy, age: 0 });
      for (const fish of fishRef.current) {
        if (fish.personality !== "timid") continue;
        const fdx = fish.spine[0].x - cx;
        const fdy = fish.spine[0].y - cy;
        if (fdx * fdx + fdy * fdy > STARTLE_RADIUS * STARTLE_RADIUS) continue;
        fish.behavior = "dart";
        fish.behaviorTimer = 0;
        fish.behaviorDuration = 40 + Math.random() * 20;
        fish.targetSpeed = fish.profile.baseSpeed * 2.5;
        fish.angle += angleDiff(fish.angle, Math.atan2(fdy, fdx)) * 0.6;
      }
    };

    // Pause the sim while the tab is hidden or the window unfocused — no
    // reason to spend CPU offscreen. startLoop resets lastTimeRef, so
    // resuming doesn't produce a dt spike.
    const handleVisibility = () => {
      if (document.hidden) stopLoop();
      else startLoop();
    };
    const handleBlur = () => stopLoop();
    const handleFocus = () => startLoop();

    // Kick off sprite loading. The animation loop upgrades to sprites the next
    // frame automatically; a reduced-motion static frame is redrawn on ready.
    loadFishSprites(() => {
      if (reducedMotion && sizeRef.current.w > 0) drawStaticScene();
    });

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    canvas.addEventListener("mousemove", handleMouse);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    canvas.addEventListener("click", handleClick);

    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      canvas.removeEventListener("mousemove", handleMouse);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      canvas.removeEventListener("click", handleClick);
      stopLoop();
    };
  }, [animate]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0"
      style={{ zIndex: 5, cursor: "default" }}
    />
  );
}

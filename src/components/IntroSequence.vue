<script setup lang="ts">
import { ref, onMounted } from 'vue'

const emit = defineEmits<{
  (e: 'complete'): void
}>()

const phase = ref(0) // 0: black, 1: logo, 2: boot lines, 3: status bar, 4: fade out
const bootLines = ref<string[]>([])
const bootProgress = ref(0)
const showSkip = ref(false)

const allBootLines = [
  '[SYS] Wing-Net Omni v1.0.0 — Tactical Digital Twin Engine',
  '[CORE] Initializing Three.js WebGL renderer …',
  '[CORE] Post-processing pipeline: Bloom + RenderPass ✓',
  '[NET]  Loading UAV telemetry data stream …',
  '[NET]  Establishing ns-3 simulation bridge …',
  '[ALGO] Graph-Coloring channel allocation engine online',
  '[TOPO] Building topology mesh — 12 nodes discovered',
  '[QoS]  PDR monitor active | P99 latency tracker active',
  '[3D]   Scene geometry loaded — CBD district mapped',
  '[SYS]  All subsystems nominal — READY',
]

let skipRequested = false

function skip() {
  skipRequested = true
  phase.value = 4
  setTimeout(() => emit('complete'), 400)
}

onMounted(async () => {
  // Show skip button after 1s
  setTimeout(() => (showSkip.value = true), 1000)

  // Phase 1: Logo reveal
  await wait(300)
  phase.value = 1
  await wait(1500)

  if (skipRequested) return

  // Phase 2: Boot lines
  phase.value = 2
  for (let i = 0; i < allBootLines.length; i++) {
    if (skipRequested) return
    bootLines.value.push(allBootLines[i])
    bootProgress.value = ((i + 1) / allBootLines.length) * 100
    await wait(180 + Math.random() * 120)
  }

  await wait(400)
  if (skipRequested) return

  // Phase 3: Status bar
  phase.value = 3
  await wait(1200)
  if (skipRequested) return

  // Phase 4: Fade out
  phase.value = 4
  await wait(600)
  emit('complete')
})

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
</script>

<template>
  <div class="intro-overlay" :class="{ 'fade-out': phase === 4 }">
    <!-- Scan lines texture -->
    <div class="intro-scanlines"></div>

    <!-- Particle field background -->
    <div class="particle-field">
      <div v-for="i in 40" :key="i" class="particle"
        :style="{
          left: Math.random() * 100 + '%',
          top: Math.random() * 100 + '%',
          animationDelay: Math.random() * 5 + 's',
          animationDuration: 3 + Math.random() * 4 + 's',
        }"
      ></div>
    </div>

    <!-- Phase 1: Logo -->
    <div class="logo-stage" :class="{ active: phase >= 1, shrink: phase >= 2 }">
      <div class="intro-logo-icon">
        <svg width="80" height="80" viewBox="0 0 28 28" class="intro-logo-svg">
          <polygon points="14,2 26,14 14,26 2,14" fill="none" stroke="currentColor" stroke-width="1" />
          <polygon points="14,6 22,14 14,22 6,14" fill="none" stroke="currentColor" stroke-width="0.5" opacity="0.5" />
          <circle cx="14" cy="14" r="2" fill="currentColor" />
        </svg>
      </div>
      <div class="intro-logo-text">
        <span class="intro-title">天枢·翼阵</span>
        <span class="intro-subtitle">Celestial Pivot</span>
      </div>
      <div class="intro-tagline" :class="{ visible: phase >= 1 }">
        城市低空物流数字孪生指挥舱
      </div>
    </div>

    <!-- Phase 2: Boot Terminal -->
    <div class="boot-terminal" :class="{ active: phase >= 2 }">
      <div class="terminal-window">
        <div class="terminal-header">
          <span class="terminal-dot red"></span>
          <span class="terminal-dot yellow"></span>
          <span class="terminal-dot green"></span>
          <span class="terminal-title">SYSTEM INITIALIZATION</span>
        </div>
        <div class="terminal-body">
          <div v-for="(line, idx) in bootLines" :key="idx" class="boot-line"
            :class="{
              success: line.includes('✓') || line.includes('READY'),
              highlight: line.includes('Graph-Coloring'),
            }"
          >
            {{ line }}
          </div>
          <span class="cursor-blink" v-if="phase === 2">█</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: bootProgress + '%' }"></div>
        </div>
      </div>
    </div>

    <!-- Phase 3: System Online -->
    <div class="system-online" :class="{ active: phase >= 3 }">
      <div class="online-badge">
        <span class="online-dot"></span>
        SYSTEM ONLINE — ALL SUBSYSTEMS NOMINAL
      </div>
    </div>

    <!-- Skip Button -->
    <button v-if="showSkip && phase < 4" class="skip-btn" @click="skip">
      SKIP ▶
    </button>
  </div>
</template>

<style scoped>
.intro-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background:
    radial-gradient(circle at top, rgba(35, 215, 230, 0.08), transparent 38%),
    linear-gradient(180deg, #101827 0%, #162033 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: opacity 0.6s ease;
  overflow: hidden;
}

.intro-overlay.fade-out {
  opacity: 0;
  pointer-events: none;
}

.intro-scanlines {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 0.04) 2px,
    rgba(0, 0, 0, 0.04) 4px
  );
  pointer-events: none;
  z-index: 1;
}

/* ── Particles ── */
.particle-field {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.particle {
  position: absolute;
  width: 2px;
  height: 2px;
  background: rgba(35, 215, 230, 0.35);
  border-radius: 50%;
  animation: particle-float linear infinite;
}

@keyframes particle-float {
  0% { transform: translateY(0) scale(1); opacity: 0; }
  20% { opacity: 1; }
  80% { opacity: 1; }
  100% { transform: translateY(-80px) scale(0.3); opacity: 0; }
}

/* ── Logo ── */
.logo-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  opacity: 0;
  transform: scale(1.2);
  transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 10;
  margin-top: -48px;
}

.logo-stage.active {
  opacity: 1;
  transform: scale(1);
}

.logo-stage.shrink {
  transform: scale(0.6) translateY(-100px);
  opacity: 0.6;
}

.intro-logo-icon {
  color: #23d7e6;
  filter: drop-shadow(0 0 18px rgba(35, 215, 230, 0.5));
}

.intro-logo-svg {
  animation: logo-pulse 2s ease-in-out infinite, logo-rotation 10s linear infinite;
}

@keyframes logo-pulse {
  0%, 100% { filter: drop-shadow(0 0 6px rgba(35, 215, 230, 0.35)); }
  50% { filter: drop-shadow(0 0 20px rgba(35, 215, 230, 0.7)); }
}

@keyframes logo-rotation {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.intro-title {
  font-family: var(--font-body);
  font-size: 36px;
  font-weight: 900;
  color: #e4edf7;
  letter-spacing: 12px;
  text-shadow: 0 0 24px rgba(35, 215, 230, 0.24);
}

.intro-subtitle {
  font-family: var(--font-display);
  font-size: 14px;
  color: #23d7e6;
  letter-spacing: 6px;
  text-shadow: 0 0 10px rgba(35, 215, 230, 0.25);
}

.intro-logo-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.intro-tagline {
  font-family: var(--font-body);
  font-size: 13px;
  color: rgba(182, 197, 212, 0);
  letter-spacing: 4px;
  margin-top: 4px;
  transition: color 1s ease 0.5s;
}

.intro-tagline.visible {
  color: rgba(182, 197, 212, 0.82);
}

/* ── Boot Terminal ── */
.boot-terminal {
  position: absolute;
  bottom: 12%;
  left: 50%;
  transform: translateX(-50%);
  width: 580px;
  opacity: 0;
  transition: opacity 0.4s ease;
  z-index: 10;
}

.boot-terminal.active {
  opacity: 1;
}

.terminal-window {
  background: rgba(22, 32, 51, 0.94);
  border: 1px solid rgba(111, 159, 245, 0.18);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 20px 44px rgba(0, 0, 0, 0.3);
}

.terminal-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(35, 215, 230, 0.05);
  border-bottom: 1px solid rgba(111, 159, 245, 0.12);
}

.terminal-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.terminal-dot.red { background: #ff5f57; }
.terminal-dot.yellow { background: #ffbd2e; }
.terminal-dot.green { background: #28c840; }

.terminal-title {
  font-family: var(--font-display);
  font-size: 9px;
  color: rgba(182, 197, 212, 0.72);
  letter-spacing: 2px;
  margin-left: 8px;
}

.terminal-body {
  padding: 12px 16px;
  max-height: 220px;
  overflow-y: auto;
}

.boot-line {
  font-family: var(--font-mono);
  font-size: 11px;
  color: rgba(182, 197, 212, 0.86);
  line-height: 1.8;
  animation: line-appear 0.2s ease;
}

.boot-line.success {
  color: var(--green);
  text-shadow: 0 0 8px rgba(34, 197, 94, 0.35);
}

.boot-line.highlight {
  color: #23d7e6;
  text-shadow: 0 0 8px rgba(35, 215, 230, 0.28);
}

@keyframes line-appear {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.cursor-blink {
  color: #23d7e6;
  animation: blink 0.8s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.progress-track {
  height: 2px;
  background: rgba(255, 255, 255, 0.06);
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #23d7e6, #22c55e);
  transition: width 0.2s ease;
  box-shadow: 0 0 8px rgba(35, 215, 230, 0.28);
}

/* ── System Online ── */
.system-online {
  position: absolute;
  bottom: 5%;
  left: 50%;
  transform: translateX(-50%);
  opacity: 0;
  transition: opacity 0.5s ease;
  z-index: 10;
}

.system-online.active {
  opacity: 1;
}

.online-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-display);
  font-size: 12px;
  color: #22c55e;
  letter-spacing: 3px;
  text-shadow: 0 0 12px rgba(34, 197, 94, 0.28);
  animation: badge-pulse 1.2s ease-in-out infinite;
}

@keyframes badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.online-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 10px rgba(34, 197, 94, 0.45);
}

/* ── Skip ── */
.skip-btn {
  position: absolute;
  bottom: 24px;
  right: 32px;
  background: none;
  border: 1px solid rgba(111, 159, 245, 0.18);
  color: rgba(182, 197, 212, 0.55);
  font-family: var(--font-display);
  font-size: 10px;
  letter-spacing: 2px;
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  z-index: 20;
  transition: all 0.2s ease;
}

.skip-btn:hover {
  color: #23d7e6;
  border-color: rgba(35, 215, 230, 0.36);
  background: rgba(35, 215, 230, 0.06);
}
</style>

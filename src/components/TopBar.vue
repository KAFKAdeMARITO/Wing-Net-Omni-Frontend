<script setup lang="ts">
import { inject, computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { currentFormation, formationLabels, formationIcons, switchFormation } from '../composables/useFormation'
import type { FormationType } from '../data/mockData'

const engine = inject<any>('engine')
const frame = computed(() => engine?.currentFrame?.value)
const connectivity = computed(() => frame.value ? Math.round(frame.value.topology.connectivity * 100) : 0)
const conflicts = computed(() => frame.value?.conflicts || 0)

// Dynamic health color for status line
const healthGradient = computed(() => {
  const c = connectivity.value
  if (c >= 90 && conflicts.value === 0) return 'linear-gradient(90deg, transparent, #00ff88, #00f2ff, #00ff88, transparent)'
  if (c >= 75) return 'linear-gradient(90deg, transparent, #00f2ff, #a855f7, #00f2ff, transparent)'
  if (c >= 60) return 'linear-gradient(90deg, transparent, #ffaa00, #ff3b3b, #ffaa00, transparent)'
  return 'linear-gradient(90deg, transparent, #ff3b3b, #ff3b3b, transparent)'
})

// Real system clock
const realTime = ref('')
let clockTimer: ReturnType<typeof setInterval> | null = null

function updateClock() {
  const now = new Date()
  realTime.value = now.toLocaleTimeString('zh-CN', { hour12: false })
}

onMounted(() => {
  updateClock()
  clockTimer = setInterval(updateClock, 1000)
})

onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<template>
  <header class="top-bar glass-panel">
    <!-- Scan line effect -->
    <div class="scan-line-track">
      <div class="scan-line-beam"></div>
    </div>

    <div class="top-left">
      <div class="logo">
        <div class="logo-icon">
          <svg width="28" height="28" viewBox="0 0 28 28" class="logo-svg">
            <polygon points="14,2 26,14 14,26 2,14" fill="none" stroke="currentColor" stroke-width="1.5" />
            <polygon points="14,6 22,14 14,22 6,14" fill="none" stroke="currentColor" stroke-width="0.8" opacity="0.5" />
            <circle cx="14" cy="14" r="2" fill="currentColor" />
          </svg>
        </div>
        <div class="logo-text">
          <span class="logo-main">翼网全境</span>
          <span class="logo-sub">WING-NET OMNI</span>
        </div>
      </div>
    </div>

    <div class="top-center">
      <div class="status-chips">
        <div class="chip" id="topo-chip">
          <span class="dot green-dot"></span>
          拓扑连通 {{ connectivity }}%
        </div>
        <div class="chip" :class="{ warn: conflicts > 0, danger: conflicts > 2 }" id="conflict-chip">
          <span class="dot" :class="conflicts > 0 ? 'red-dot' : 'green-dot'"></span>
          同频冲突 {{ conflicts }}
        </div>
        <div class="chip">
          <span class="dot cyan-dot"></span>
          引擎在线
        </div>
      </div>

      <!-- 阵型切换 -->
      <div class="formation-selector">
        <span class="formation-label">FORMATION</span>
        <div class="formation-btns">
          <button
            v-for="fType in (['v_formation', 'line', 'triangle', 'cross'] as FormationType[])"
            :key="fType"
            class="formation-btn"
            :class="{ active: currentFormation === fType }"
            @click="switchFormation(fType)"
            :title="formationLabels[fType]"
          >
            <span class="formation-icon">{{ formationIcons[fType] }}</span>
            <span class="formation-name">{{ formationLabels[fType] }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="top-right">
      <div class="sys-time">
        <span class="time-label">SIM TICK</span>
        <span class="time-value">{{ frame?.tick ?? 0 }}</span>
      </div>
      <div class="real-clock">
        <span class="time-label">SYSTEM</span>
        <span class="clock-value">{{ realTime }}</span>
      </div>
    </div>

    <!-- Dynamic health status line -->
    <div class="health-status-line" :style="{ background: healthGradient }"></div>
  </header>
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 20px;
  margin: 8px 8px 8px;
  border-bottom: 1px solid var(--glass-border);
  position: relative;
  z-index: 100;
  overflow: hidden;
}

.top-bar::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 10%;
  right: 10%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--cyan), transparent);
}

/* Scan line beam */
.scan-line-track {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.scan-line-beam {
  position: absolute;
  top: 0;
  left: 0;
  width: 60px;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(0, 242, 255, 0.06), transparent);
  animation: scan-line-h 4s linear infinite;
}

.top-left { display: flex; align-items: center; }

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo-icon {
  color: var(--cyan);
  filter: drop-shadow(0 0 8px rgba(0, 242, 255, 0.6));
}

.logo-svg {
  animation: logo-breathe 3s ease-in-out infinite, logo-spin 20s linear infinite;
}

@keyframes logo-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes logo-breathe {
  0%, 100% { filter: drop-shadow(0 0 4px rgba(0, 242, 255, 0.5)); }
  50% { filter: drop-shadow(0 0 16px rgba(0, 242, 255, 1)); }
}

.logo-text {
  display: flex;
  flex-direction: column;
}

.logo-main {
  font-family: var(--font-body);
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 4px;
}

.logo-sub {
  font-family: var(--font-display);
  font-size: 9px;
  color: var(--cyan);
  letter-spacing: 3px;
}

.top-center { display: flex; align-items: center; }

.status-chips {
  display: flex;
  gap: 12px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}

.green-dot { background: var(--green); box-shadow: 0 0 6px var(--green); }
.cyan-dot { background: var(--cyan); box-shadow: 0 0 6px var(--cyan); }
.red-dot { background: var(--red); box-shadow: 0 0 6px var(--red); animation: pulse-danger 1s infinite; }

.top-right {
  display: flex;
  align-items: center;
  gap: 20px;
}

.sys-time, .real-clock {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.time-label {
  font-family: var(--font-display);
  font-size: 9px;
  color: var(--text-dim);
  letter-spacing: 2px;
}

.time-value {
  font-family: var(--font-mono);
  font-size: 20px;
  font-weight: 700;
  color: var(--cyan);
  text-shadow: var(--cyan-glow);
}

.clock-value {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 1px;
}

.health-status-line {
  position: absolute;
  bottom: -1px;
  left: 5%;
  right: 5%;
  height: 2px;
  border-radius: 1px;
  transition: background 1s ease;
  z-index: 2;
}

/* ── Formation Selector ── */
.formation-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 16px;
  padding-left: 16px;
  border-left: 1px solid var(--glass-border);
}

.formation-label {
  font-family: var(--font-display);
  font-size: 8px;
  color: var(--text-dim);
  letter-spacing: 2px;
}

.formation-btns {
  display: flex;
  gap: 4px;
}

.formation-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: none;
  border: 1px solid transparent;
  color: var(--text-dim);
  font-family: var(--font-body);
  font-size: 11px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.formation-btn:hover {
  color: var(--cyan);
  border-color: var(--glass-border);
}

.formation-btn.active {
  color: var(--cyan);
  border-color: var(--cyan);
  background: var(--cyan-dim);
  box-shadow: 0 0 8px rgba(0, 242, 255, 0.15);
}

.formation-icon {
  font-size: 12px;
}

.formation-name {
  font-size: 10px;
}
</style>

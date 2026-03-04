<script setup lang="ts">
import { inject, computed, ref, onMounted, onBeforeUnmount } from 'vue'

const engine = inject<any>('engine')
const frame = computed(() => engine?.currentFrame?.value)
const connectivity = computed(() => frame.value ? Math.round(frame.value.topology.connectivity * 100) : 0)
const conflicts = computed(() => frame.value?.conflicts || 0)

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
  animation: logo-spin 12s linear infinite;
}

@keyframes logo-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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
</style>

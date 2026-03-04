<script setup lang="ts">
import { inject, computed, reactive, watch } from 'vue'
import gsap from 'gsap'

const engine = inject<any>('engine')
const frame = computed(() => engine?.currentFrame?.value)

const qos = computed(() => frame.value?.QoS || { total_pdr: 0, p99_latency_ms: 0, throughput_mbps: 0, algo_compute_time_ms: 0 })
const topo = computed(() => frame.value?.topology || { num_links: 0, connectivity: 0 })

const healthScore = computed(() => Math.round((qos.value.total_pdr) * 100))

// Animated values (Vue reactive proxy for template binding)
const display = reactive({
  pdr: 0,
  latency: 0,
  throughput: 0,
  links: 0,
  connectivity: 0,
  health: 0
})

// Plain JS tween targets (GSAP animates these, then we sync to Vue reactive)
const _tweenQos = { pdr: 0, latency: 0, throughput: 0 }
const _tweenTopo = { links: 0, connectivity: 0 }
const _tweenHealth = { health: 0 }

watch(qos, (n) => {
  if (!n) return
  gsap.to(_tweenQos, {
    pdr: (n.total_pdr || 0) * 100,
    latency: n.p99_latency_ms || 0,
    throughput: n.throughput_mbps || 0,
    duration: 0.3,
    ease: 'power2.out',
    onUpdate() {
      display.pdr = _tweenQos.pdr
      display.latency = _tweenQos.latency
      display.throughput = _tweenQos.throughput
    },
    onComplete() {
      display.pdr = _tweenQos.pdr
      display.latency = _tweenQos.latency
      display.throughput = _tweenQos.throughput
    }
  })
}, { deep: true, immediate: true })

watch(topo, (n) => {
  if (!n) return
  gsap.to(_tweenTopo, {
    links: n.num_links || 0,
    connectivity: (n.connectivity || 0) * 100,
    duration: 0.3,
    ease: 'power2.out',
    onUpdate() {
      display.links = _tweenTopo.links
      display.connectivity = _tweenTopo.connectivity
    },
    onComplete() {
      display.links = _tweenTopo.links
      display.connectivity = _tweenTopo.connectivity
    }
  })
}, { deep: true, immediate: true })

watch(healthScore, (n) => {
  gsap.to(_tweenHealth, {
    health: n || 0,
    duration: 0.3,
    ease: 'power2.out',
    onUpdate() {
      display.health = _tweenHealth.health
    },
    onComplete() {
      display.health = _tweenHealth.health
    }
  })
}, { immediate: true })

const pdrPct = computed(() => display.pdr.toFixed(1))
const latencyDisplay = computed(() => display.latency.toFixed(1))
const throughput = computed(() => display.throughput.toFixed(1))
const links = computed(() => Math.round(display.links))
const connectivity = computed(() => display.connectivity.toFixed(1))
const displayHealth = computed(() => Math.round(display.health))

const healthColor = computed(() => {
  const s = healthScore.value
  if (s >= 90) return '#00ff88'
  if (s >= 75) return '#00f2ff'
  if (s >= 60) return '#ffaa00'
  return '#ff3b3b'
})

// UAV list
const uavList = computed(() => {
  if (!frame.value) return []
  return frame.value.uav_nodes.slice(0, 15)
})

const channelLabels = ['CH1', 'CH2', 'CH3']
const channelColors = ['#00f2ff', '#a855f7', '#00ff88']
</script>

<template>
  <aside class="left-panel">
    <!-- QoS 健康圆环 -->
    <div class="glass-panel health-ring-card">
      <div class="section-title">QoS INDEX</div>
      <div class="ring-container">
        <svg viewBox="0 0 140 140" class="health-ring">
          <!-- Outer decorative orbit -->
          <circle cx="70" cy="70" r="66" fill="none" stroke="rgba(0,242,255,0.06)" stroke-width="0.5" stroke-dasharray="4 6" />
          <!-- Background track -->
          <circle cx="70" cy="70" r="56" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="8" />
          <!-- Main arc -->
          <circle cx="70" cy="70" r="56" fill="none"
            :stroke="healthColor"
            stroke-width="8"
            stroke-linecap="round"
            :stroke-dasharray="`${display.health * 3.52} 352`"
            transform="rotate(-90 70 70)"
            style="filter: drop-shadow(0 0 8px currentColor); transition: all 0.3s ease;" />
          <!-- Rotating particle dots -->
          <g class="ring-particles">
            <circle cx="70" cy="4" r="1.5" :fill="healthColor" opacity="0.8" />
            <circle cx="136" cy="70" r="1" :fill="healthColor" opacity="0.5" />
            <circle cx="70" cy="136" r="1.2" :fill="healthColor" opacity="0.6" />
          </g>
        </svg>
        <div class="ring-value" id="health-val" :style="{ color: healthColor }">
          {{ displayHealth }}
        </div>
        <div class="ring-label">SYSTEM HEALTH</div>
      </div>
    </div>

    <!-- 核心指标 -->
    <div class="glass-panel metrics-card">
      <div class="section-title">核心指标</div>
      <div class="metrics-grid">
        <div class="metric-item">
          <span class="stat-label">平均 PDR</span>
          <span class="stat-value green" id="m-pdr">{{ pdrPct }}%</span>
        </div>
        <div class="metric-item">
          <span class="stat-label">P99 时延</span>
          <span class="stat-value" id="m-delay">{{ latencyDisplay }}ms</span>
        </div>
        <div class="metric-item">
          <span class="stat-label">总吞吐</span>
          <span class="stat-value" id="m-tp">{{ throughput }}</span>
        </div>
        <div class="metric-item">
          <span class="stat-label">活跃链路</span>
          <span class="stat-value" id="m-link">{{ links }}</span>
        </div>
        <div class="metric-item full-width">
          <span class="stat-label">全局连通率</span>
          <span class="stat-value green" id="t-conn">{{ connectivity }}%</span>
        </div>
      </div>
    </div>

    <!-- 活动节点列表 -->
    <div class="glass-panel uav-list-card">
      <div class="section-title">活动节点档案</div>
      <div class="uav-scroll" id="uav-list">
        <div
          v-for="(uav, idx) in uavList"
          :key="uav.id"
          class="uav-row"
          :class="{ conflict: uav.is_conflict, nlos: uav.is_nlos }"
          :style="{ animationDelay: `${Number(idx) * 0.03}s` }"
        >
          <div class="uav-id">UAV-{{ String(uav.id).padStart(2, '0') }}</div>
          <div class="uav-channel" :style="{ background: channelColors[uav.channel], boxShadow: `0 0 8px ${channelColors[uav.channel]}40` }">
            {{ channelLabels[uav.channel] }}
          </div>
          <div class="uav-power-bar">
            <div class="power-fill" :style="{ width: `${(uav.power || 20) / 23 * 100}%`, background: channelColors[uav.channel] }"></div>
          </div>
          <div class="uav-energy">{{ uav.energy.toFixed(0) }}%</div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.left-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  overflow-y: auto;
  padding-right: 4px;
}

.health-ring-card {
  padding: 16px;
  text-align: center;
}

.ring-container {
  position: relative;
  width: 145px;
  height: 145px;
  margin: 8px auto;
}

.health-ring {
  width: 100%;
  height: 100%;
}

.ring-particles {
  transform-origin: 70px 70px;
  animation: ring-orbit 8s linear infinite;
}

@keyframes ring-orbit {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.ring-value {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -60%);
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: 900;
  text-shadow: 0 0 20px currentColor;
}

.ring-label {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, 60%);
  font-family: var(--font-display);
  font-size: 8px;
  letter-spacing: 2px;
  color: var(--text-dim);
}

.metrics-card {
  padding: 14px;
}

.metrics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.metric-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-item.full-width {
  grid-column: 1 / -1;
}

.uav-list-card {
  padding: 14px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.uav-scroll {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.uav-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.02);
  transition: all var(--transition-fast);
  animation: stagger-in 0.3s ease both;
}

.uav-row:hover {
  background: var(--bg-hover);
}

.uav-row.conflict {
  background: rgba(255, 59, 59, 0.1);
  border-left: 2px solid var(--red);
}

.uav-row.nlos {
  border-left: 2px solid var(--orange);
}

.uav-id {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  min-width: 50px;
}

.uav-channel {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  color: var(--bg-deep);
  padding: 2px 6px;
  border-radius: 3px;
  min-width: 32px;
  text-align: center;
}

.uav-power-bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
}

.power-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.5s ease;
}

.uav-energy {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  min-width: 32px;
  text-align: right;
}
</style>

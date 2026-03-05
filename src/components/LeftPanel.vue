<script setup lang="ts">
import { inject, computed, reactive, watch, ref } from 'vue'
import gsap from 'gsap'
import { apiService, type SimulationConfig } from '../services/apiService'
import { currentFormation } from '../composables/useFormation'
import { activeScene } from '../composables/useScene'

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

// --- Simulation Controls ---
const simConfig = reactive({
  swarm_size: 15,
  difficulty: 'Hard' as const,
  strategy: 'dynamic' as const
})
const isSimulating = ref(false)

async function handleStartSim() {
  if (isSimulating.value) return
  isSimulating.value = true
  try {
    const config: SimulationConfig = {
      buildings: activeScene.buildings,
      swarm_size: simConfig.swarm_size,
      difficulty: simConfig.difficulty,
      strategy: simConfig.strategy,
      formation: currentFormation.value
    }
    const resultFrames = await apiService.startSimulation(config)
    engine.loadFrames(resultFrames)
    engine.play()
  } catch(e) {
    console.error('仿真启动失败', e)
  } finally {
    isSimulating.value = false
  }
}
</script>

<template>
  <aside class="left-panel">
    <!-- 智能推演控制 -->
    <div class="glass-panel sim-control-card">
      <div class="section-title">智能推演控制台</div>
      <div class="control-form compact">
        <div class="form-row-multi">
          <div class="form-group">
            <label>规模</label>
            <select v-model="simConfig.swarm_size" class="glass-select">
              <option :value="15">15 架</option>
              <option :value="30">30 架</option>
              <option :value="50">50 架</option>
            </select>
          </div>
          <div class="form-group">
            <label>难度</label>
            <select v-model="simConfig.difficulty" class="glass-select">
              <option value="Easy">Easy</option>
              <option value="Moderate">Mid</option>
              <option value="Hard">Hard</option>
            </select>
          </div>
          <div class="form-group" style="flex: 1.5;">
            <label>策略</label>
            <select v-model="simConfig.strategy" class="glass-select">
              <option value="static">Static</option>
              <option value="dynamic">AI Dynamic</option>
            </select>
          </div>
        </div>
        <button class="glass-btn primary sim-btn" :class="{ loading: isSimulating }" @click="handleStartSim" :disabled="isSimulating">
          <span v-if="!isSimulating">🚀 开始实景推演</span>
          <span v-else>⏳ 计算中...</span>
        </button>
      </div>
    </div>

    <!-- 监控总览 (Ring + Metrics) -->
    <div class="glass-panel combined-qos-card">
      <div class="section-title">网络效能总览</div>
      <div class="combined-qos-content">
        <!-- QoS 健康圆环 (缩放版) -->
        <div class="ring-container small-ring">
          <svg viewBox="0 0 100 100" class="health-ring">
            <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(0,242,255,0.06)" stroke-width="0.5" stroke-dasharray="3 4" />
            <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="6" />
            <circle cx="50" cy="50" r="42" fill="none"
              :stroke="healthColor"
              stroke-width="6"
              stroke-linecap="round"
              :stroke-dasharray="`${display.health * 2.64} 264`"
              transform="rotate(-90 50 50)"
              style="filter: drop-shadow(0 0 6px currentColor); transition: all 0.3s ease;" />
          </svg>
          <div class="ring-value small-val" id="health-val" :style="{ color: healthColor }">
            {{ displayHealth }}
          </div>
          <div class="ring-label small-label">HEALTH</div>
        </div>

        <!-- 核心指标 -->
        <div class="metrics-grid dense-grid">
          <div class="metric-item">
            <span class="stat-label">PDR</span>
            <span class="stat-value green" id="m-pdr">{{ pdrPct }}%</span>
          </div>
          <div class="metric-item">
            <span class="stat-label">P99时延</span>
            <span class="stat-value" id="m-delay">{{ latencyDisplay }}ms</span>
          </div>
          <div class="metric-item">
            <span class="stat-label">总吞吐</span>
            <span class="stat-value" id="m-tp">{{ throughput }}</span>
          </div>
          <div class="metric-item">
            <span class="stat-label">连通率</span>
            <span class="stat-value green" id="t-conn">{{ connectivity }}%</span>
          </div>
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

.sim-control-card {
  padding: 12px;
  flex-shrink: 0;
}

.control-form.compact {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-row-multi {
  display: flex;
  gap: 6px;
  justify-content: space-between;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.form-group label {
  font-size: 10px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.glass-select {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--glass-border);
  color: var(--text-primary);
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 11px;
  outline: none;
  cursor: pointer;
  transition: all var(--transition-fast);
  width: 100%;
}

.glass-select:hover {
  border-color: var(--cyan);
}

.sim-btn {
  margin-top: 4px;
  width: 100%;
  padding: 8px;
  font-size: 12px;
  font-weight: bold;
}

.sim-btn.loading {
  opacity: 0.7;
  cursor: wait;
}

/* QoS 总览卡片 */
.combined-qos-card {
  padding: 12px;
  flex-shrink: 0;
}

.combined-qos-content {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 8px;
}

/* 缩放版圆环 */
.ring-container.small-ring {
  width: 90px;
  height: 90px;
  margin: 0;
}

.health-ring {
  width: 100%;
  height: 100%;
}

.ring-value.small-val {
  font-size: 24px;
  transform: translate(-50%, -60%);
}

.ring-label.small-label {
  font-size: 8px;
  transform: translate(-50%, 70%);
}

/* 密集核心指标排列 */
.metrics-grid.dense-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  row-gap: 8px;
  column-gap: 12px;
}

.metric-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-label {
  font-size: 10px;
  color: var(--text-dim);
}

.stat-value {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 700;
}

.stat-value.green {
  color: #00ff88;
  text-shadow: 0 0 8px rgba(0, 255, 136, 0.4);
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

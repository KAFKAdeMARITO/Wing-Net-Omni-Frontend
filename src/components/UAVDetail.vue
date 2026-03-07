<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import type { UAVNode } from '../types'

const props = defineProps<{
  uav: UAVNode
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const channelLabels = ['CH-α  5.1 GHz', 'CH-β  5.4 GHz', 'CH-γ  5.8 GHz']
const channelColors = ['#00f2ff', '#a855f7', '#10b981']
const channelColor = computed(() => channelColors[props.uav.channel] || '#00f2ff')

const uavRole = computed(() =>
  props.uav.id === 0
    ? { tag: 'LEAD', label: '长机 · 指挥节点', icon: '◆' }
    : props.uav.id % 5 === 0
      ? { tag: 'RELAY', label: '中继 · 骨干节点', icon: '◈' }
      : { tag: 'WING', label: '僚机 · 末端节点', icon: '◇' }
)

const flightStatus = computed(() =>
  props.uav.is_conflict || props.uav.is_in_zone
    ? { text: '紧急避障机动', level: 'critical' }
    : { text: '沿航线巡航', level: 'nominal' }
)

const interferenceLevel = computed(() => Math.min(100, (props.uav.interference || 0) * 100))
const interferenceGrade = computed(() => {
  const v = props.uav.interference || 0
  if (v < 0.2) return { text: 'CLEAR', color: '#00ff88' }
  if (v < 0.5) return { text: 'MODERATE', color: '#facc15' }
  return { text: 'SEVERE', color: '#ff3b3b' }
})

const isIsolated = computed(() => (props.uav.neighbors || 0) <= 1)
const pdr = computed(() => (props.uav.pdr || 0) * 100)
const delay = computed(() => props.uav.delay || 0)
const throughput = computed(() => props.uav.throughput || 0)
const energy = computed(() => props.uav.energy || 0)

const energyStatus = computed(() => {
  if (energy.value > 60) return { color: '#00ff88', label: 'NOMINAL' }
  if (energy.value > 30) return { color: '#facc15', label: 'LOW' }
  return { color: '#ff3b3b', label: 'CRITICAL' }
})

/* ── Mini Radar Chart ── */
const radarEl = ref<HTMLDivElement | null>(null)
let radarChart: echarts.ECharts | null = null

function initRadar() {
  if (!radarEl.value) return
  radarChart = echarts.init(radarEl.value)
  updateRadar()
}

function updateRadar() {
  if (!radarChart) return
  const cc = channelColor.value
  radarChart.setOption({
    backgroundColor: 'transparent',
    radar: {
      indicator: [
        { name: 'PDR', max: 100 },
        { name: 'SPEED', max: 100 },
        { name: 'LINK', max: 10 },
        { name: 'BATT', max: 100 },
        { name: 'SNR', max: 40 }
      ],
      center: ['50%', '50%'],
      radius: '65%',
      shape: 'polygon',
      splitNumber: 4,
      axisName: {
        color: '#64748b',
        fontSize: 9,
        fontFamily: 'monospace'
      },
      splitArea: {
        areaStyle: {
          color: ['rgba(0,242,255,0.02)', 'rgba(0,242,255,0.04)', 'rgba(0,242,255,0.02)', 'rgba(0,242,255,0.04)']
        }
      },
      splitLine: {
        lineStyle: { color: 'rgba(255,255,255,0.06)', width: 1 }
      },
      axisLine: {
        lineStyle: { color: 'rgba(255,255,255,0.08)' }
      }
    },
    series: [{
      type: 'radar',
      data: [{
        value: [
          pdr.value,
          throughput.value,
          props.uav.neighbors || 0,
          energy.value,
          Math.max(0, 35 - delay.value)
        ],
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: {
          color: cc,
          width: 2,
          shadowColor: cc,
          shadowBlur: 8
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: cc + '50' },
            { offset: 1, color: cc + '08' }
          ])
        },
        itemStyle: {
          color: cc,
          borderColor: cc,
          borderWidth: 1,
          shadowColor: cc,
          shadowBlur: 6
        }
      }]
    }],
    animation: true
  })
}

/* ── Lifecycle ── */
onMounted(async () => {
  await nextTick()
  setTimeout(initRadar, 100)
})

onBeforeUnmount(() => {
  radarChart?.dispose()
})

watch(() => props.uav, () => {
  updateRadar()
}, { deep: true })

/* ── Animated entry ── */
const entered = ref(false)
onMounted(() => {
  requestAnimationFrame(() => { entered.value = true })
})

function onClose() {
  entered.value = false
  setTimeout(() => emit('close'), 250)
}
</script>

<template>
  <Teleport to="body">
    <div
      class="overlay"
      :class="{ entered }"
      @click.self="onClose"
    >
      <div
        class="detail-card"
        :class="{ entered, 'shake-alert': (uav.interference || 0) > 0.6 }"
      >
        <!-- ═══ Decorative top accent ═══ -->
        <div class="accent-line" :style="{ '--ac': channelColor }"></div>
        <div class="corner tl"></div>
        <div class="corner tr"></div>
        <div class="corner bl"></div>
        <div class="corner br"></div>

        <!-- ═══ HEADER ═══ -->
        <header class="hdr">
          <div class="hdr-left">
            <div class="id-chip" :style="{ '--ac': channelColor }">
              <span class="chip-icon">{{ uavRole.icon }}</span>
              <span class="chip-id">UAV-{{ String(uav.id).padStart(2, '0') }}</span>
            </div>
            <div class="role-line">
              <span class="role-tag" :style="{ borderColor: channelColor, color: channelColor }">{{ uavRole.tag }}</span>
              <span class="role-label">{{ uavRole.label }}</span>
            </div>
          </div>
          <div class="hdr-right">
            <div class="status-pill" :class="flightStatus.level">
              <span class="pulse-ring"></span>
              {{ flightStatus.text }}
            </div>
            <button class="close-x" @click="onClose" aria-label="关闭">
              <svg width="14" height="14" viewBox="0 0 14 14">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.5" fill="none"/>
              </svg>
            </button>
          </div>
        </header>

        <!-- ═══ BODY (scrollable) ═══ -->
        <div class="body">

          <!-- ── Section 1: Position & Radar ── -->
          <section class="sec">
            <div class="sec-label">01 ─ SPATIAL & OVERVIEW</div>
            <div class="spatial-row">
              <!-- Coordinates -->
              <div class="coord-block">
                <div class="coord" v-for="(axis, i) in ['X','Y','Z']" :key="axis">
                  <span class="axis">{{ axis }}</span>
                  <span class="num">{{ [uav.x, uav.y, uav.z || 30][i].toFixed(1) }}</span>
                  <span class="unit">m</span>
                </div>
                <div class="coord heading">
                  <span class="axis">HDG</span>
                  <span class="num">{{ ((uav.id * 37 + 90) % 360).toFixed(0) }}</span>
                  <span class="unit">°</span>
                </div>
              </div>
              <!-- Mini radar -->
              <div ref="radarEl" class="radar-mini"></div>
            </div>
          </section>

          <!-- ── Section 2: AI Channel / Power ── -->
          <section class="sec">
            <div class="sec-label">02 ─ AI RESOURCE ALLOCATION</div>

            <div class="res-grid">
              <div class="res-cell channel-cell" :style="{ '--ac': channelColor }">
                <div class="cell-head">FREQUENCY</div>
                <div class="cell-body">
                  <span class="freq-dot" :style="{ background: channelColor }"></span>
                  <span class="freq-txt" :style="{ color: channelColor }">{{ channelLabels[uav.channel] }}</span>
                </div>
              </div>
              <div class="res-cell">
                <div class="cell-head">TX POWER</div>
                <div class="cell-body">
                  <span class="power-val" :class="{ surge: (uav.power || 20) > 24 }">{{ (uav.power || 20).toFixed(1) }}</span>
                  <span class="power-unit">dBm</span>
                </div>
              </div>
            </div>

            <!-- Interference -->
            <div class="emi-block">
              <div class="emi-top">
                <span class="emi-label">EMI INTERFERENCE</span>
                <span class="emi-badge" :style="{ color: interferenceGrade.color, borderColor: interferenceGrade.color + '40' }">
                  {{ interferenceGrade.text }}
                </span>
                <span class="emi-val">{{ (uav.interference || 0).toFixed(3) }}</span>
              </div>
              <div class="emi-track">
                <div
                  class="emi-fill"
                  :style="{
                    width: interferenceLevel + '%',
                    background: `linear-gradient(90deg, ${interferenceGrade.color}30, ${interferenceGrade.color})`
                  }"
                ></div>
                <!-- Grid ticks -->
                <span v-for="i in 9" :key="i" class="emi-tick" :style="{ left: (i * 10) + '%' }"></span>
              </div>
            </div>
          </section>

          <!-- ── Section 3: Topology ── -->
          <section class="sec">
            <div class="sec-label">03 ─ MESH TOPOLOGY</div>
            <div class="topo-row">
              <div class="topo-visual">
                <!-- Center node -->
                <div class="topo-center" :style="{ borderColor: channelColor }">
                  <span :style="{ color: channelColor }">{{ String(uav.id).padStart(2,'0') }}</span>
                </div>
                <!-- Neighbor dots -->
                <div
                  v-for="n in Math.min(uav.neighbors || 0, 6)"
                  :key="n"
                  class="topo-neighbor"
                  :style="{
                    '--angle': ((360 / Math.min(uav.neighbors || 1, 6)) * (n - 1) - 90) + 'deg',
                    animationDelay: (n * 0.15) + 's'
                  }"
                >
                  <span class="topo-link"></span>
                  <span class="topo-dot"></span>
                </div>
              </div>
              <div class="topo-stats">
                <div class="topo-num">
                  <span class="big">{{ uav.neighbors || 0 }}</span>
                  <span class="small">NEIGHBORS</span>
                </div>
                <div v-if="isIsolated" class="topo-alert">
                  <span class="alert-icon">⚠</span>
                  <span>孤岛风险 · MESH 链路不足</span>
                </div>
                <div v-else class="topo-ok">
                  <span class="ok-icon">✓</span>
                  <span>MESH 链路稳定</span>
                </div>
              </div>
            </div>
          </section>

          <!-- ── Section 4: QoS Gauges ── -->
          <section class="sec">
            <div class="sec-label">04 ─ QoS TELEMETRY</div>
            <div class="qos-list">
              <!-- PDR -->
              <div class="qos-row">
                <div class="qos-meta">
                  <span class="qos-icon" style="color: #00ff88">●</span>
                  <span class="qos-name">PDR</span>
                </div>
                <div class="qos-bar-wrap">
                  <div class="qos-bar">
                    <div class="qos-fill" :style="{ width: pdr + '%', '--fc': '#00ff88' }"></div>
                  </div>
                </div>
                <span class="qos-val" :style="{ color: pdr > 80 ? '#00ff88' : pdr > 50 ? '#facc15' : '#ff3b3b' }">
                  {{ pdr.toFixed(1) }}<small>%</small>
                </span>
              </div>
              <!-- Delay -->
              <div class="qos-row">
                <div class="qos-meta">
                  <span class="qos-icon" style="color: #00f2ff">●</span>
                  <span class="qos-name">DELAY</span>
                </div>
                <div class="qos-bar-wrap">
                  <div class="qos-bar">
                    <div class="qos-fill" :style="{ width: Math.min(100, delay * 1.67) + '%', '--fc': '#00f2ff' }"></div>
                  </div>
                </div>
                <span class="qos-val" :style="{ color: delay < 20 ? '#00ff88' : delay < 40 ? '#facc15' : '#ff3b3b' }">
                  {{ delay.toFixed(1) }}<small>ms</small>
                </span>
              </div>
              <!-- Throughput -->
              <div class="qos-row">
                <div class="qos-meta">
                  <span class="qos-icon" style="color: #a855f7">●</span>
                  <span class="qos-name">THRU</span>
                </div>
                <div class="qos-bar-wrap">
                  <div class="qos-bar">
                    <div class="qos-fill" :style="{ width: Math.min(100, throughput) + '%', '--fc': '#a855f7' }"></div>
                  </div>
                </div>
                <span class="qos-val" style="color: #a855f7">
                  {{ throughput.toFixed(1) }}<small>Mb/s</small>
                </span>
              </div>
            </div>
          </section>

          <!-- ── Footer: Link Health ── -->
          <footer class="link-footer">
            <div class="link-left">
              <span class="link-label">LINK HEALTH</span>
              <span class="link-status" :style="{ color: (uav.pdr || 0) > 0.8 ? '#00ff88' : (uav.pdr || 0) > 0.5 ? '#facc15' : '#ff3b3b' }">
                {{ (uav.pdr || 0) > 0.8 ? 'EXCELLENT' : (uav.pdr || 0) > 0.5 ? 'WARNING' : 'CRITICAL' }}
              </span>
            </div>
            <div class="link-bar-area">
              <div class="link-bar">
                <div
                  class="link-fill"
                  :style="{ 
                    width: ((uav.pdr || 0) * 100) + '%', 
                    background: (uav.pdr || 0) > 0.8 ? '#00ff88' : (uav.pdr || 0) > 0.5 ? '#facc15' : '#ff3b3b' 
                  }"
                ></div>
              </div>
            </div>
            <span class="link-pct" :style="{ color: (uav.pdr || 0) > 0.8 ? '#00ff88' : (uav.pdr || 0) > 0.5 ? '#facc15' : '#ff3b3b' }">
              {{ ((uav.pdr || 0) * 100).toFixed(0) }}%
            </span>
          </footer>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ════════════════════════════════════════════
   Overlay
   ════════════════════════════════════════════ */
.overlay {
  position: fixed; inset: 0; z-index: 2000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(2, 6, 18, 0);
  backdrop-filter: blur(0px);
  transition: background 0.3s, backdrop-filter 0.3s;
}
.overlay.entered {
  background: rgba(2, 6, 18, 0.55);
  backdrop-filter: blur(12px);
}

/* ════════════════════════════════════════════
   Card Shell
   ════════════════════════════════════════════ */
.detail-card {
  width: 460px; max-height: 88vh;
  display: flex; flex-direction: column;
  background: linear-gradient(165deg, rgba(8, 14, 30, 0.96), rgba(4, 7, 18, 0.98));
  border: 1px solid rgba(0, 242, 255, 0.12);
  border-radius: 6px;
  position: relative;
  overflow: hidden;
  box-shadow:
    0 0 60px rgba(0, 242, 255, 0.06),
    0 30px 80px rgba(0, 0, 0, 0.5);
  /* entry animation */
  opacity: 0;
  transform: translateY(24px) scale(0.96);
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.detail-card.entered {
  opacity: 1;
  transform: translateY(0) scale(1);
}

/* Accent top line */
.accent-line {
  position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent, var(--ac), transparent);
  box-shadow: 0 0 20px var(--ac);
}

/* Corner brackets */
.corner {
  position: absolute; width: 12px; height: 12px;
  border-color: rgba(0, 242, 255, 0.25);
  border-style: solid;
  pointer-events: none;
}
.corner.tl { top: -1px; left: -1px; border-width: 2px 0 0 2px; border-radius: 4px 0 0 0; }
.corner.tr { top: -1px; right: -1px; border-width: 2px 2px 0 0; border-radius: 0 4px 0 0; }
.corner.bl { bottom: -1px; left: -1px; border-width: 0 0 2px 2px; border-radius: 0 0 0 4px; }
.corner.br { bottom: -1px; right: -1px; border-width: 0 2px 2px 0; border-radius: 0 0 4px 0; }

/* Scan line overlay */
.detail-card::after {
  content: '';
  position: absolute; inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent, transparent 3px,
    rgba(0, 242, 255, 0.012) 3px,
    rgba(0, 242, 255, 0.012) 4px
  );
  pointer-events: none;
}

/* ════════════════════════════════════════════
   Header
   ════════════════════════════════════════════ */
.hdr {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: 20px 22px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  position: relative; z-index: 1;
}

.hdr-left { display: flex; flex-direction: column; gap: 8px; }

.id-chip {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 22px; font-weight: 700;
  color: #e2e8f0;
  line-height: 1;
}
.chip-icon {
  font-size: 14px; color: var(--ac);
  text-shadow: 0 0 12px var(--ac);
}
.chip-id { letter-spacing: 2px; }

.role-line { display: flex; align-items: center; gap: 8px; }
.role-tag {
  font-size: 9px; font-family: monospace; letter-spacing: 2px;
  padding: 2px 8px;
  border: 1px solid;
  border-radius: 2px;
  font-weight: 600;
}
.role-label {
  font-size: 11px; color: #64748b;
}

.hdr-right { display: flex; align-items: center; gap: 10px; }

.status-pill {
  display: flex; align-items: center; gap: 6px;
  font-size: 10px; font-family: monospace; letter-spacing: 0.5px;
  padding: 4px 10px; border-radius: 20px;
  position: relative;
}
.status-pill.nominal {
  color: #00ff88;
  background: rgba(0, 255, 136, 0.08);
  border: 1px solid rgba(0, 255, 136, 0.15);
}
.status-pill.critical {
  color: #ff3b3b;
  background: rgba(255, 59, 59, 0.1);
  border: 1px solid rgba(255, 59, 59, 0.2);
  animation: pill-blink 1.2s infinite;
}
@keyframes pill-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.pulse-ring {
  width: 6px; height: 6px; border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 6px currentColor;
  animation: pulse-dot 2s infinite;
}
.status-pill.critical .pulse-ring { animation-duration: 0.8s; }

@keyframes pulse-dot {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(0.6); opacity: 0.4; }
}

.close-x {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 4px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  color: #64748b; cursor: pointer;
  transition: all 0.2s;
}
.close-x:hover {
  background: rgba(255,59,59,0.12);
  border-color: rgba(255,59,59,0.3);
  color: #ff6b6b;
}

/* ════════════════════════════════════════════
   Scrollable Body
   ════════════════════════════════════════════ */
.body {
  flex: 1; overflow-y: auto;
  padding: 6px 22px 22px;
  display: flex; flex-direction: column; gap: 20px;
  position: relative; z-index: 1;
}
.body::-webkit-scrollbar { width: 3px; }
.body::-webkit-scrollbar-thumb { background: rgba(0,242,255,0.15); border-radius: 3px; }

/* ── Section wrapper ── */
.sec {
  display: flex; flex-direction: column; gap: 12px;
}
.sec-label {
  font-size: 9px; font-family: monospace;
  color: #475569; letter-spacing: 2.5px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

/* ════════════════════════════════════════════
   S1 – Spatial + Radar
   ════════════════════════════════════════════ */
.spatial-row {
  display: flex; gap: 16px; align-items: stretch;
}

.coord-block {
  flex: 1;
  display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
}
.coord {
  display: flex; align-items: baseline; gap: 6px;
  background: rgba(0,0,0,0.25);
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.04);
}
.coord .axis {
  font-size: 10px; color: #475569;
  font-family: monospace; font-weight: 600;
  min-width: 24px;
}
.coord .num {
  font-size: 16px; font-family: monospace; font-weight: 600;
  color: #cbd5e1;
}
.coord .unit { font-size: 10px; color: #475569; }
.coord.heading .num { color: #facc15; }

.radar-mini {
  width: 150px; min-width: 150px; height: 150px;
  flex-shrink: 0;
}

/* ════════════════════════════════════════════
   S2 – Resource Allocation
   ════════════════════════════════════════════ */
.res-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
}
.res-cell {
  background: rgba(0,0,0,0.25);
  padding: 12px; border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.04);
  display: flex; flex-direction: column; gap: 8px;
}
.cell-head {
  font-size: 9px; color: #475569;
  font-family: monospace; letter-spacing: 1.5px;
}
.cell-body {
  display: flex; align-items: center; gap: 8px;
}

.freq-dot {
  width: 8px; height: 8px; border-radius: 50%;
  box-shadow: 0 0 8px currentColor;
  animation: pulse-dot 2.5s infinite;
}
.freq-txt {
  font-family: monospace; font-size: 13px; font-weight: 600;
  letter-spacing: 0.5px;
}

.channel-cell {
  border-left: 2px solid var(--ac);
}

.power-val {
  font-family: monospace; font-size: 20px; font-weight: 700;
  color: #e2e8f0;
  transition: color 0.3s;
}
.power-val.surge {
  color: #ff3b3b;
  text-shadow: 0 0 10px rgba(255, 59, 59, 0.5);
  animation: pill-blink 0.8s infinite;
}
.power-unit {
  font-size: 11px; color: #64748b; font-family: monospace;
}

/* EMI */
.emi-block {
  display: flex; flex-direction: column; gap: 8px;
  margin-top: 4px;
}
.emi-top {
  display: flex; align-items: center; gap: 8px;
}
.emi-label {
  font-size: 9px; color: #475569; font-family: monospace;
  letter-spacing: 1.5px; flex: 1;
}
.emi-badge {
  font-size: 9px; font-family: monospace; font-weight: 600;
  letter-spacing: 1px; padding: 1px 6px;
  border: 1px solid; border-radius: 2px;
}
.emi-val {
  font-size: 12px; color: #94a3b8; font-family: monospace;
}
.emi-track {
  height: 8px;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 4px;
  position: relative; overflow: hidden;
  border: 1px solid rgba(255,255,255,0.04);
}
.emi-fill {
  height: 100%; border-radius: 4px;
  transition: width 0.4s ease;
  box-shadow: 0 0 8px rgba(0,242,255,0.2);
}
.emi-tick {
  position: absolute; top: 0; bottom: 0; width: 1px;
  background: rgba(255,255,255,0.06);
}

/* ════════════════════════════════════════════
   S3 – Topology
   ════════════════════════════════════════════ */
.topo-row {
  display: flex; align-items: center; gap: 24px;
}

.topo-visual {
  width: 100px; height: 100px; flex-shrink: 0;
  position: relative;
  display: flex; align-items: center; justify-content: center;
}

.topo-center {
  width: 32px; height: 32px;
  border-radius: 50%;
  border: 2px solid;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-family: monospace; font-weight: 700;
  z-index: 2;
  box-shadow: 0 0 16px rgba(0, 242, 255, 0.15);
}

.topo-neighbor {
  position: absolute;
  top: 50%; left: 50%;
  width: 40px; height: 0;
  transform-origin: 0 0;
  transform: rotate(var(--angle));
  animation: topo-fade 0.5s ease forwards;
  opacity: 0;
}
@keyframes topo-fade {
  to { opacity: 1; }
}

.topo-link {
  position: absolute; top: -0.5px; left: 0;
  width: 100%; height: 1px;
  background: linear-gradient(90deg, rgba(0,242,255,0.3), rgba(0,242,255,0.08));
}
.topo-dot {
  position: absolute; right: -4px; top: -4px;
  width: 8px; height: 8px; border-radius: 50%;
  background: rgba(0, 242, 255, 0.6);
  box-shadow: 0 0 6px rgba(0, 242, 255, 0.4);
}

.topo-stats {
  flex: 1;
  display: flex; flex-direction: column; gap: 10px;
}
.topo-num {
  display: flex; flex-direction: column;
}
.topo-num .big {
  font-size: 36px; font-weight: 700;
  font-family: monospace;
  line-height: 1; color: #e2e8f0;
}
.topo-num .small {
  font-size: 9px; color: #475569;
  font-family: monospace; letter-spacing: 2px;
  margin-top: 2px;
}

.topo-alert {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: #ff3b3b;
  background: rgba(255, 59, 59, 0.08);
  padding: 6px 10px; border-radius: 4px;
  border: 1px solid rgba(255, 59, 59, 0.15);
  animation: pill-blink 1s infinite;
}
.alert-icon { font-size: 14px; }

.topo-ok {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: #00ff88;
  background: rgba(0, 255, 136, 0.06);
  padding: 6px 10px; border-radius: 4px;
  border: 1px solid rgba(0, 255, 136, 0.1);
}
.ok-icon {
  width: 16px; height: 16px; border-radius: 50%;
  background: rgba(0, 255, 136, 0.15);
  display: flex; align-items: center; justify-content: center;
  font-size: 10px;
}

/* ════════════════════════════════════════════
   S4 – QoS Bars
   ════════════════════════════════════════════ */
.qos-list {
  display: flex; flex-direction: column; gap: 14px;
}

.qos-row {
  display: flex; align-items: center; gap: 10px;
}
.qos-meta {
  display: flex; align-items: center; gap: 5px;
  min-width: 56px;
}
.qos-icon { font-size: 8px; }
.qos-name {
  font-size: 10px; font-family: monospace; color: #64748b;
  letter-spacing: 1px;
}

.qos-bar-wrap { flex: 1; }
.qos-bar {
  height: 6px;
  background: rgba(255,255,255,0.04);
  border-radius: 3px; overflow: hidden;
}
.qos-fill {
  height: 100%; border-radius: 3px;
  background: var(--fc);
  box-shadow: 0 0 8px var(--fc);
  transition: width 0.4s ease;
}

.qos-val {
  min-width: 64px; text-align: right;
  font-size: 14px; font-family: monospace; font-weight: 700;
}
.qos-val small {
  font-size: 10px; font-weight: 400; opacity: 0.6;
  margin-left: 1px;
}

/* ════════════════════════════════════════════
   Link Health Footer
   ════════════════════════════════════════════ */
.link-footer {
  display: flex; align-items: center; gap: 12px;
  padding-top: 14px;
  border-top: 1px solid rgba(255,255,255,0.04);
  margin-top: 4px;
}
.link-left {
  display: flex; flex-direction: column; gap: 2px;
  min-width: 60px;
}
.link-label {
  font-size: 8px; color: #475569; font-family: monospace;
  letter-spacing: 2px;
}
.link-status {
  font-size: 9px; font-family: monospace; font-weight: 600;
  letter-spacing: 1px;
}

.link-bar-area {
  flex: 1;
  display: flex; align-items: center;
}
.link-bar {
  flex: 1; height: 10px;
  background: rgba(0,0,0,0.3);
  border-radius: 2px;
  border: 1px solid rgba(255,255,255,0.06);
  overflow: hidden;
}
.link-fill {
  height: 100%;
  transition: width 0.5s ease, background 0.5s;
  border-radius: 1px;
  box-shadow: 0 0 8px currentColor;
}
.link-pct {
  font-size: 16px; font-family: monospace; font-weight: 700;
  min-width: 44px; text-align: right;
}

/* ════════════════════════════════════════════
   Shake
   ════════════════════════════════════════════ */
.shake-alert {
  animation: mini-shake 0.3s infinite;
}
@keyframes mini-shake {
  0%   { transform: translate(0, 0); }
  25%  { transform: translate(1px, -1px); }
  50%  { transform: translate(-1px, 1px); }
  75%  { transform: translate(1px, 1px); }
  100% { transform: translate(0, 0); }
}
</style>
<script setup lang="ts">
import { inject, computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'

const engine = inject<any>('engine')
const frame = computed(() => engine?.currentFrame?.value)
const qos = computed(() => frame.value?.QoS || { total_pdr: 0, throughput_mbps: 0, p99_latency_ms: 0 })

const pdrHistory = ref<number[]>([])
const tpHistory = ref<number[]>([])
const tickLabels = ref<number[]>([])
const MAX_HISTORY = 60

const pdrChartEl = ref<HTMLDivElement | null>(null)
const tpChartEl = ref<HTMLDivElement | null>(null)
const spectrumChartEl = ref<HTMLDivElement | null>(null)
let pdrChart: echarts.ECharts | null = null
let tpChart: echarts.ECharts | null = null
let spectrumChart: echarts.ECharts | null = null

const channelCounts = computed(() => {
  if (!frame.value) return [0, 0, 0]
  const counts = [0, 0, 0]
  for (const uav of frame.value.uav_nodes) {
    if (uav.channel >= 0 && uav.channel < 3) counts[uav.channel]++
  }
  return counts
})

const qAvail = computed(() => (qos.value.total_pdr * 100).toFixed(1))
const qP99 = computed(() => qos.value.p99_latency_ms.toFixed(1))
const qEE = computed(() => {
  if (!frame.value) return '0.0'
  const pwrs = frame.value.uav_nodes.map((u: any) => u.power || 20)
  return (pwrs.reduce((a: number, b: number) => a + b, 0) / pwrs.length).toFixed(1)
})

function makeLineOption(title: string, color: string, data: number[], labels: number[]): echarts.EChartsOption {
  return {
    grid: { top: 28, right: 8, bottom: 18, left: 40 },
    title: {
      text: title,
      textStyle: { color: '#94a3b8', fontFamily: 'monospace', fontSize: 9, fontWeight: 'normal' },
      left: 0, top: 2
    },
    xAxis: {
      type: 'category', data: labels,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisLabel: { show: false }, axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
      axisLabel: { color: '#64748b', fontSize: 9, fontFamily: 'monospace' }
    },
    series: [{
      type: 'line', data, smooth: true, symbol: 'none',
      lineStyle: { 
        color, 
        width: 2,
        shadowColor: color,
        shadowBlur: 10
      },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: color + '60' },
          { offset: 1, color: color + '05' }
        ])
      }
    }],
    animation: false
  }
}

function updateCharts() {
  if (!frame.value) return

  pdrHistory.value.push(qos.value.total_pdr * 100)
  tpHistory.value.push(qos.value.throughput_mbps)
  tickLabels.value.push(frame.value.tick)
  if (pdrHistory.value.length > MAX_HISTORY) {
    pdrHistory.value.shift()
    tpHistory.value.shift()
    tickLabels.value.shift()
  }

  if (pdrChart) pdrChart.setOption(makeLineOption('PDR (%)', '#3b82f6', pdrHistory.value, tickLabels.value))
  if (tpChart) tpChart.setOption(makeLineOption('THROUGHPUT (Mbps)', '#a855f7', tpHistory.value, tickLabels.value))

  if (spectrumChart) {
    spectrumChart.setOption({
      grid: { top: 28, right: 8, bottom: 24, left: 30 },
      title: {
        text: 'SPECTRUM',
        textStyle: { color: '#94a3b8', fontFamily: 'monospace', fontSize: 9, fontWeight: 'normal' },
        left: 0, top: 2
      },
      xAxis: {
        type: 'category', data: ['CH1', 'CH2', 'CH3'],
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10, fontFamily: 'monospace' }
      },
      yAxis: {
        type: 'value', max: 15,
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
        axisLabel: { color: '#64748b', fontSize: 9, fontFamily: 'monospace' }
      },
      series: [{
        type: 'bar', barWidth: '40%',
        data: [
          { value: channelCounts.value[0], itemStyle: { color: '#00f2ff', borderRadius: [4, 4, 0, 0], shadowColor: '#00f2ff', shadowBlur: 8 } },
          { value: channelCounts.value[1], itemStyle: { color: '#a855f7', borderRadius: [4, 4, 0, 0], shadowColor: '#a855f7', shadowBlur: 8 } },
          { value: channelCounts.value[2], itemStyle: { color: '#00ff88', borderRadius: [4, 4, 0, 0], shadowColor: '#00ff88', shadowBlur: 8 } }
        ]
      }],
      animation: false
    })
  }
}

function initCharts() {
  if (pdrChartEl.value) {
    pdrChart = echarts.init(pdrChartEl.value)
  }
  if (tpChartEl.value) {
    tpChart = echarts.init(tpChartEl.value)
  }
  if (spectrumChartEl.value) {
    spectrumChart = echarts.init(spectrumChartEl.value)
  }
}

// Use ResizeObserver to handle chart resizing
let resizeOb: ResizeObserver | null = null
const panelRef = ref<HTMLElement | null>(null)

onMounted(async () => {
  // Wait for DOM to be fully laid out
  await nextTick()
  await nextTick()
  // Small delay to ensure CSS layout is computed
  setTimeout(() => {
    initCharts()
    updateCharts()
    // Observe panel for resize
    resizeOb = new ResizeObserver(() => {
      pdrChart?.resize()
      tpChart?.resize()
      spectrumChart?.resize()
    })
    if (panelRef.value) resizeOb.observe(panelRef.value)
  }, 200)
})

onBeforeUnmount(() => {
  pdrChart?.dispose()
  tpChart?.dispose()
  spectrumChart?.dispose()
  resizeOb?.disconnect()
})

watch(frame, updateCharts)
</script>

<template>
  <aside ref="panelRef" class="right-panel">
    <!-- PDR 折线图 -->
    <div class="glass-panel chart-card">
      <div ref="pdrChartEl" id="pdr-lines" class="echart-box"></div>
    </div>

    <!-- 吞吐量折线图 -->
    <div class="glass-panel chart-card">
      <div ref="tpChartEl" id="tp-lines" class="echart-box"></div>
    </div>

    <!-- 频谱柱状图 -->
    <div class="glass-panel chart-card">
      <div ref="spectrumChartEl" id="spectrum-grid" class="echart-box"></div>
    </div>

    <!-- 灾难 QoS -->
    <div class="glass-panel qos-card" :class="{ 'qos-healthy': parseFloat(qAvail) >= 90, 'qos-warning': parseFloat(qAvail) < 90 && parseFloat(qAvail) >= 70, 'qos-danger': parseFloat(qAvail) < 70 }">
      <div class="section-title">灾难 QoS 定量</div>
      <div class="qos-grid">
        <div class="qos-item">
          <span class="stat-label">🛡️ 可用性</span>
          <span class="stat-value" id="q-avail">{{ qAvail }}%</span>
        </div>
        <div class="qos-item">
          <span class="stat-label">⏱ P99 上限</span>
          <span class="stat-value" id="q-p99">{{ qP99 }}ms</span>
        </div>
        <div class="qos-item">
          <span class="stat-label">⚡ 均方功率</span>
          <span class="stat-value" id="q-ee">{{ qEE }}dBm</span>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.right-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  overflow-y: auto;
  padding-left: 4px;
}

.chart-card {
  padding: 8px;
  flex-shrink: 0;
  animation: ambient-glow 4s ease-in-out infinite alternate;
}

@keyframes ambient-glow {
  from { border-color: rgba(0, 242, 255, 0.1); box-shadow: 0 0 10px rgba(0, 242, 255, 0.05) inset; }
  to   { border-color: rgba(0, 242, 255, 0.3); box-shadow: 0 0 20px rgba(0, 242, 255, 0.15) inset; }
}

.echart-box {
  width: 100%;
  height: 150px;
  min-height: 150px;
}

.qos-card {
  padding: 14px;
  flex-shrink: 0;
  border-top: 2px solid transparent;
  transition: border-color 0.5s ease;
}

.qos-card.qos-healthy {
  border-top-color: var(--green);
}

.qos-card.qos-warning {
  border-top-color: var(--orange);
}

.qos-card.qos-danger {
  border-top-color: var(--red);
  animation: pulse-danger 1.5s infinite;
}

.qos-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}

.qos-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: center;
}

.qos-item .stat-value {
  font-size: 16px;
}
</style>

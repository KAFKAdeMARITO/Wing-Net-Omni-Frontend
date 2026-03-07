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
const delayChartEl = ref<HTMLDivElement | null>(null)
const interferenceChartEl = ref<HTMLDivElement | null>(null)

let pdrChart: echarts.ECharts | null = null
let tpChart: echarts.ECharts | null = null
let delayChart: echarts.ECharts | null = null
let interferenceChart: echarts.ECharts | null = null

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

function makeGaugeOption(value: number): echarts.EChartsOption {
  // Determine color zone based on value
  const getColor = (v: number) => {
    if (v <= 15) return '#00ff88'
    if (v <= 35) return '#00f2ff'
    if (v <= 50) return '#facc15'
    return '#ff3b3b'
  }

  const currentColor = getColor(value)

  return {
    backgroundColor: 'transparent',
    series: [
      // ── 最外层：装饰环（静态薄环） ──
      {
        type: 'gauge',
        center: ['50%', '62%'],
        radius: '95%',
        startAngle: 220,
        endAngle: -40,
        min: 0,
        max: 60,
        axisLine: {
          lineStyle: {
            width: 1,
            color: [[1, 'rgba(0, 242, 255, 0.15)']]
          }
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        detail: { show: false }
      },

      // ── 第二层：主刻度弧线（渐变色带） ──
      {
        type: 'gauge',
        center: ['50%', '62%'],
        radius: '88%',
        startAngle: 220,
        endAngle: -40,
        min: 0,
        max: 60,
        axisLine: {
          lineStyle: {
            width: 14,
            color: [
              [0.25, new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                { offset: 0, color: '#00ff8840' },
                { offset: 1, color: '#00ff88' }
              ]) as any],
              [0.58, new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                { offset: 0, color: '#00f2ff' },
                { offset: 1, color: '#facc15' }
              ]) as any],
              [1, new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                { offset: 0, color: '#facc15' },
                { offset: 1, color: '#ff3b3b' }
              ]) as any]
            ],
            shadowColor: 'rgba(0, 242, 255, 0.3)',
            shadowBlur: 16
          }
        },
        axisTick: {
          distance: -20,
          length: 6,
          lineStyle: {
            color: 'rgba(255,255,255,0.2)',
            width: 1
          }
        },
        splitLine: {
          distance: -24,
          length: 12,
          lineStyle: {
            color: 'rgba(255,255,255,0.4)',
            width: 2,
            shadowColor: 'rgba(0, 242, 255, 0.5)',
            shadowBlur: 6
          }
        },
        axisLabel: {
          distance: -32,
          color: '#64748b',
          fontSize: 10,
          fontFamily: 'monospace',
          formatter: (v: number) => {
            if (v % 10 === 0) return v + ''
            return ''
          }
        },
        pointer: { show: false },
        detail: { show: false }
      },

      // ── 第三层：进度弧（发光当前值弧线） ──
      {
        type: 'gauge',
        center: ['50%', '62%'],
        radius: '72%',
        startAngle: 220,
        endAngle: -40,
        min: 0,
        max: 60,
        axisLine: {
          lineStyle: {
            width: 4,
            color: [[1, 'rgba(255,255,255,0.03)']]
          }
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        detail: { show: false },
        progress: {
          show: true,
          width: 4,
          roundCap: true,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 1, y2: 0,
              colorStops: [
                { offset: 0, color: currentColor + '40' },
                { offset: 1, color: currentColor }
              ]
            } as any,
            shadowColor: currentColor,
            shadowBlur: 12
          }
        },
        data: [{ value }]
      },

      // ── 第四层：指针（赛博尖针） ──
      {
        type: 'gauge',
        center: ['50%', '62%'],
        radius: '80%',
        startAngle: 220,
        endAngle: -40,
        min: 0,
        max: 60,
        itemStyle: {
          color: currentColor,
          shadowColor: currentColor,
          shadowBlur: 16,
          shadowOffsetY: 0
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: {
          icon: 'path://M2090.36389,bindbindneedlepath M-0.5,-80 L0.5,-80 L0.5,0 C0.5,0.28,-0.5,0.28,-0.5,0 Z',
          width: 3,
          length: '65%',
          offsetCenter: [0, 0],
          itemStyle: {
            color: currentColor,
            shadowColor: currentColor,
            shadowBlur: 10
          }
        },
        anchor: {
          show: true,
          showAbove: true,
          size: 12,
          itemStyle: {
            borderWidth: 2,
            borderColor: currentColor,
            color: '#0f172a',
            shadowColor: currentColor,
            shadowBlur: 14
          }
        },
        title: {
          show: true,
          offsetCenter: [0, '38%'],
          fontSize: 9,
          color: '#475569',
          fontFamily: 'monospace',
          fontWeight: 'normal'
        },
        detail: {
          valueAnimation: true,
          fontSize: 28,
          fontWeight: 'bold',
          fontFamily: "'Orbitron', 'Rajdhani', monospace",
          offsetCenter: [0, '68%'],
          formatter: (v: number) => {
            return '{val|' + v.toFixed(1) + '}{unit| ms}'
          },
          rich: {
            val: {
              fontSize: 26,
              fontWeight: 'bold',
              fontFamily: "monospace",
              color: currentColor,
              textShadowColor: currentColor,
              textShadowBlur: 14,
              padding: [0, 2, 0, 0]
            },
            unit: {
              fontSize: 11,
              color: '#64748b',
              fontFamily: 'monospace',
              padding: [6, 0, 0, 2]
            }
          }
        },
        data: [{
          value,
          name: '⚡ LATENCY'
        }]
      },

      // ── 第五层：中心装饰小环 ──
      {
        type: 'gauge',
        center: ['50%', '62%'],
        radius: '30%',
        startAngle: 0,
        endAngle: 360,
        min: 0,
        max: 1,
        axisLine: {
          lineStyle: {
            width: 1,
            color: [[1, 'rgba(0, 242, 255, 0.08)']]
          }
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        detail: { show: false }
      }
    ]
  }
}

function makeBubbleOption(uavNodes: any[]): echarts.EChartsOption {
  // Convert nodes to bubble data point format format [x(ID), y(Interference), size(Interference)]
  const data = uavNodes.map(u => [u.id, u.interference || 0, Math.max(2, (u.interference || 0) * 80)])
  
  return {
    grid: { top: 25, right: 15, bottom: 20, left: 35 },
    title: {
      text: '热力气泡 (机频干扰感知)',
      textStyle: { color: '#94a3b8', fontFamily: 'monospace', fontSize: 9, fontWeight: 'normal' },
      left: 0, top: 2
    },
    xAxis: {
      type: 'value',
      name: 'NodeID',
      nameTextStyle: { fontSize: 8, color: '#64748b' },
      splitLine: { show: false },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisLabel: { color: '#64748b', fontSize: 9, fontFamily: 'monospace' },
    },
    yAxis: {
      type: 'value',
      name: 'EMI',
      nameTextStyle: { fontSize: 8, color: '#64748b' },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
      axisLabel: { color: '#64748b', fontSize: 9, fontFamily: 'monospace' },
      max: function(value) { return Math.max(1, value.max); }
    },
    series: [{
      name: 'EMI Scatter',
      type: 'scatter',
      data: data,
      itemStyle: {
        color: new echarts.graphic.RadialGradient(0.5, 0.5, 0.5, [
          { offset: 0, color: 'rgba(255,59,59,0.8)' },
          { offset: 1, color: 'rgba(255,59,59,0.1)' }
        ])
      },
      symbolSize: function (data: any) {
        return data[2]; // bubble size
      },
      animation: false
    }]
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

  if (pdrChart) pdrChart.setOption(makeLineOption('PDR脉搏线 (%)', '#00f2ff', pdrHistory.value, tickLabels.value))
  if (tpChart) tpChart.setOption(makeLineOption('吞吐量波浪 (Mbps)', '#a855f7', tpHistory.value, tickLabels.value))

  if (delayChart) {
    const jitter = (Math.random() - 0.5) * 0.8
    const displayValue = Math.max(0, qos.value.p99_latency_ms + jitter)
    delayChart.setOption(makeGaugeOption(displayValue))
  }
  
  if (interferenceChart) {
    interferenceChart.setOption(makeBubbleOption(frame.value.uav_nodes || []))
  }
}

function initCharts() {
  if (pdrChartEl.value) pdrChart = echarts.init(pdrChartEl.value)
  if (tpChartEl.value) tpChart = echarts.init(tpChartEl.value)
  if (delayChartEl.value) delayChart = echarts.init(delayChartEl.value)
  if (interferenceChartEl.value) interferenceChart = echarts.init(interferenceChartEl.value)
}

let resizeOb: ResizeObserver | null = null
const panelRef = ref<HTMLElement | null>(null)

onMounted(async () => {
  await nextTick()
  setTimeout(() => {
    initCharts()
    updateCharts()
    resizeOb = new ResizeObserver(() => {
      pdrChart?.resize()
      tpChart?.resize()
      delayChart?.resize()
      interferenceChart?.resize()
    })
    if (panelRef.value) resizeOb.observe(panelRef.value)
  }, 200)
})

onBeforeUnmount(() => {
  pdrChart?.dispose()
  tpChart?.dispose()
  delayChart?.dispose()
  interferenceChart?.dispose()
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

    <!-- 延时仪表盘 -->
    <div class="glass-panel chart-card delay-gauge-card">
      <!-- 状态灯 -->
      <div class="gauge-status-bar">
        <span class="status-dot" :class="{
          'dot-green': qos.p99_latency_ms <= 15,
          'dot-cyan': qos.p99_latency_ms > 15 && qos.p99_latency_ms <= 35,
          'dot-yellow': qos.p99_latency_ms > 35 && qos.p99_latency_ms <= 50,
          'dot-red': qos.p99_latency_ms > 50
        }"></span>
        <span class="gauge-label">P99 LATENCY MONITOR</span>
        <span class="gauge-zone" :class="{
          'zone-safe': qos.p99_latency_ms <= 15,
          'zone-normal': qos.p99_latency_ms > 15 && qos.p99_latency_ms <= 35,
          'zone-warn': qos.p99_latency_ms > 35 && qos.p99_latency_ms <= 50,
          'zone-crit': qos.p99_latency_ms > 50
        }">
          {{ qos.p99_latency_ms <= 15 ? 'SAFE' : qos.p99_latency_ms <= 35 ? 'NORMAL' : qos.p99_latency_ms <= 50 ? 'WARNING' : 'CRITICAL' }}
        </span>
      </div>
      <div ref="delayChartEl" id="delay-gauge" class="echart-box gauge-box"></div>
    </div>

    <!-- 灾难 QoS -->
    <div class="glass-panel qos-card" :class="{
      'qos-healthy': parseFloat(qAvail) >= 90,
      'qos-warning': parseFloat(qAvail) < 90 && parseFloat(qAvail) >= 70,
      'qos-danger': parseFloat(qAvail) < 70
    }">
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

    <!-- 热力气泡散点图 -->
    <div class="glass-panel chart-card bubble-card">
      <div ref="interferenceChartEl" id="bubble-scatt" class="echart-box bubble-box"></div>
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

.gauge-box {
  height: 190px;
  min-height: 190px;
}

.bubble-box {
  height: 160px;
  min-height: 160px;
}

/* ── 仪表盘状态栏 ── */
.delay-gauge-card {
  position: relative;
  overflow: hidden;
}

.delay-gauge-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg,
    transparent,
    rgba(0, 242, 255, 0.6),
    transparent
  );
  animation: scan-line 3s ease-in-out infinite;
}

@keyframes scan-line {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

.gauge-status-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px 0;
  font-family: monospace;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-green {
  background: #00ff88;
  box-shadow: 0 0 8px #00ff88, 0 0 16px #00ff8860;
  animation: pulse-dot 2s infinite;
}

.dot-cyan {
  background: #00f2ff;
  box-shadow: 0 0 8px #00f2ff, 0 0 16px #00f2ff60;
  animation: pulse-dot 2s infinite;
}

.dot-yellow {
  background: #facc15;
  box-shadow: 0 0 8px #facc15, 0 0 16px #facc1560;
  animation: pulse-dot 1.2s infinite;
}

.dot-red {
  background: #ff3b3b;
  box-shadow: 0 0 8px #ff3b3b, 0 0 16px #ff3b3b60;
  animation: pulse-dot 0.6s infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.8); }
}

.gauge-label {
  font-size: 9px;
  color: #475569;
  letter-spacing: 1.5px;
  flex: 1;
}

.gauge-zone {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 1px;
  padding: 1px 6px;
  border-radius: 3px;
}

.zone-safe {
  color: #00ff88;
  background: rgba(0, 255, 136, 0.1);
  border: 1px solid rgba(0, 255, 136, 0.2);
}

.zone-normal {
  color: #00f2ff;
  background: rgba(0, 242, 255, 0.1);
  border: 1px solid rgba(0, 242, 255, 0.2);
}

.zone-warn {
  color: #facc15;
  background: rgba(250, 204, 21, 0.1);
  border: 1px solid rgba(250, 204, 21, 0.2);
  animation: blink-warn 1.5s infinite;
}

.zone-crit {
  color: #ff3b3b;
  background: rgba(255, 59, 59, 0.15);
  border: 1px solid rgba(255, 59, 59, 0.3);
  animation: blink-warn 0.8s infinite;
}

@keyframes blink-warn {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* ── QoS 卡片 ── */
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
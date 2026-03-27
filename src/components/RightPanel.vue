<script setup lang="ts">
import { inject, computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import gsap from 'gsap'
import { useAppMode } from '../composables/useAppMode'
import { useWorkspaceStore } from '../composables/workspaceStore'

const { currentAppMode, currentScene } = useAppMode()
const { workspaceData } = useWorkspaceStore()

// ── 合作模式数据 ──
const coopModeSummary = computed(() => workspaceData.cooperative?.mode_summary)
const coopDashboard = computed(() => workspaceData.cooperative?.dashboard_snapshot)
const coopMetrics = computed(() => {
  const samples = workspaceData.cooperative?.metrics_timeseries?.samples
  if (Array.isArray(samples) && samples.length > 0) return samples
  return Array.isArray(workspaceData.cooperative?.recovery_metrics) ? workspaceData.cooperative.recovery_metrics : []
})
const coopFailureEvents = computed(() => {
  const events = workspaceData.cooperative?.failure_timeline?.events
  if (Array.isArray(events) && events.length > 0) return events
  const fallback = Array.isArray(workspaceData.cooperative?.failure_events) ? workspaceData.cooperative.failure_events : []
  return fallback.map((evt: any, index: number) => ({
    eventId: evt.eventId ?? index,
    time: Number(evt.time ?? evt.failure_time ?? 0),
    failureType: evt.failureType ?? evt.failure_type,
    targetNodeId: evt.targetNodeId ?? evt.target_node_id,
    targetRole: evt.targetRole ?? evt.target_role,
    isLeaderTarget: evt.isLeaderTarget ?? evt.is_leader_target,
    failureState: evt.failureState ?? evt.failure_state,
    affectedNeighborCount: evt.affectedNeighborCount ?? evt.affected_neighbor_count,
    affectedLinkCount: evt.affectedLinkCount ?? evt.affected_link_count,
    effectSummary: evt.effectSummary ?? evt.effect_summary,
    source: evt.source,
  }))
})
const coopRecoveryActions = computed(() => {
  const actions = workspaceData.cooperative?.recovery_timeline?.actions
  if (Array.isArray(actions) && actions.length > 0) return actions
  const fallback = Array.isArray(workspaceData.cooperative?.recovery_actions) ? workspaceData.cooperative.recovery_actions : []
  return fallback.map((act: any, index: number) => ({
    actionId: act.actionId ?? index,
    time: Number(act.time ?? act.action_time ?? 0),
    phase: act.phase,
    communicationMode: act.communicationMode ?? act.communication_mode,
    recoveryPolicy: act.recoveryPolicy ?? act.recovery_policy,
    effectiveRecoveryPolicy: act.effectiveRecoveryPolicy ?? act.effective_recovery_policy,
    triggerReason: act.triggerReason ?? act.trigger_reason,
    executorNodeId: act.executorNodeId ?? act.executor_node_id,
    targetNodeIds: act.targetNodeIds ?? act.target_node_ids,
    actionType: act.actionType ?? act.action_type,
    oldValue: act.oldValue ?? act.old_value,
    newValue: act.newValue ?? act.new_value,
    scope: act.scope,
    expectedEffect: act.expectedEffect ?? act.expected_effect,
    resultState: act.resultState ?? act.result_state,
  }))
})
const coopMetricSnapshot = computed(() => {
  const samples = coopMetrics.value
  if (!samples.length) return null

  const currentTime = Number(frame.value?.tick ?? Number.POSITIVE_INFINITY)
  const candidates = samples
    .map((item: any) => ({
      ...item,
      time: Number(item.time)
    }))
    .filter((item: any) => Number.isFinite(item.time))
    .sort((a: any, b: any) => a.time - b.time)

  if (!candidates.length) return samples[samples.length - 1]

  let matched = candidates[0]
  for (const item of candidates) {
    if (item.time <= currentTime) matched = item
    else break
  }
  return matched
})
const coopDerivedMetricSnapshot = computed(() => {
  if (coopMetricSnapshot.value) return coopMetricSnapshot.value
  if (!coopDashboard.value) return null
  return {
    failureNeighborhoodNodeCount: 0,
    failureNeighborhoodPdr: null,
    failureNeighborhoodThroughputMbps: null,
    failureNeighborhoodDelayMs: null,
    isFailureTargetFailed: coopDashboard.value.failureActive,
    failureTargetPdr: null,
    failureTargetDelayMs: null,
    routeChangeCount: coopDashboard.value.routeChangeCount,
    relaySwitchCount: coopDashboard.value.relaySwitchCount,
    controlDeadlineMissCount: coopDashboard.value.controlDeadlineMissCount,
    routePressureScore: coopDashboard.value.routePressureScore,
  }
})
const coopResponseTimeSec = computed(() => {
  return coopDashboard.value?.responseTimeSec ?? coopMetricSnapshot.value?.responseTimeSec ?? null
})
const coopRecoveryTimeSec = computed(() => {
  return coopDashboard.value?.recoveryTimeSec ?? coopMetricSnapshot.value?.recoveryTimeSec ?? null
})
const coopStabilizationTimeSec = computed(() => {
  return coopDashboard.value?.stabilizationTimeSec ?? coopMetricSnapshot.value?.stabilizationTimeSec ?? null
})

// ── 非合作模式数据 ──
const ncObservedEvents = computed(() => workspaceData.nonCooperative?.observation_inference?.observed_signal_events || [])
const ncObservedWindows = computed(() => workspaceData.nonCooperative?.observation_inference?.observed_comm_windows || [])
const ncInferredEdges = computed(() => workspaceData.nonCooperative?.observation_inference?.inferred_topology_edges || [])
const ncInferredNodes = computed(() => workspaceData.nonCooperative?.observation_inference?.inferred_graph_nodes || [])
const ncKeyNodes = computed(() => workspaceData.nonCooperative?.observation_inference?.key_node_candidates || [])
const ncLinkEvidence = computed(() => workspaceData.nonCooperative?.observation_inference?.observed_link_evidence || [])

const ncInferredNodesTop = computed(() => {
  return ncInferredNodes.value
    .map((item: any) => ({
      ...item,
      roleConfidence: Number(item.roleConfidence ?? 0),
      anomalyScore: Number(item.anomalyScore ?? 0)
    }))
    .sort((a: any, b: any) => b.roleConfidence - a.roleConfidence)
    .slice(0, 10)
})

// ── 非合作打击闭环数据 ──
const ncAttackRecommendations = computed(() => workspaceData.nonCooperative?.attack?.recommendations || [])
const ncAttackPlan = computed(() => workspaceData.nonCooperative?.attack?.plan)
const ncAttackEvents = computed(() => workspaceData.nonCooperative?.attack?.events || [])
const ncTargetBinding = computed(() => workspaceData.nonCooperative?.attack?.target_binding || [])
const ncAttackEffectMetrics = computed(() => workspaceData.nonCooperative?.attack?.effect_metrics || [])
const ncAttackSummary = computed(() => workspaceData.nonCooperative?.attack?.summary)
const hasAttackResults = computed(() => !!(ncAttackPlan.value || ncAttackEvents.value.length > 0 || ncAttackEffectMetrics.value.length > 0))
const ncInferChartData = computed(() => {
  return ncKeyNodes.value
    .slice(0, 5)
    .map((item, index) => ({
      label: `Node ${item.nodeId ?? index + 1}`,
      value: Number(((item.score ?? 0) * 100).toFixed(2))
    }))
})
const ncAttackEffectSeries = computed(() => {
  return ncAttackEffectMetrics.value
    .map(item => ({
      time: Number(item.time),
      connectivity: Number(((item.connectivityRatio ?? 0) * 100).toFixed(2))
    }))
    .filter(item => Number.isFinite(item.time) && Number.isFinite(item.connectivity))
    .sort((a, b) => a.time - b.time)
})
const ncLatestTargetBinding = computed(() => {
  return [...ncTargetBinding.value]
    .map((item: any) => ({
      ...item,
      eventTime: Number(item.eventTime ?? 0),
      observedNodeId: Number(item.observedNodeId ?? 0),
      bindingConfidence: Number(item.bindingConfidence ?? 0),
      executedEntityNodeId: item.executedEntityNodeId != null ? Number(item.executedEntityNodeId) : null
    }))
    .sort((a: any, b: any) => b.eventTime - a.eventTime)[0] || null
})
const ncAttackGlobalFinalMetrics = computed(() => {
  const finalMetrics = ncAttackSummary.value?.finalMetrics ?? ncAttackSummary.value?.final_metrics
  if (!finalMetrics) return null
  const raw = finalMetrics.global ?? finalMetrics
  if (!raw) return null
  // snake_case → camelCase 兼容
  return {
    connectivityRatio: raw.connectivityRatio ?? raw.connectivity_ratio,
    pdr: raw.pdr,
    throughputMbps: raw.throughputMbps ?? raw.throughput_mbps ?? raw.throughput,
    delayMs: raw.delayMs ?? raw.delay_ms ?? raw.delay,
    count: raw.count ?? raw.sample_count,
  }
})
const ncAttackNeighborhoodFinalMetrics = computed(() => {
  const finalMetrics = ncAttackSummary.value?.finalMetrics ?? ncAttackSummary.value?.final_metrics
  if (!finalMetrics) return null
  const raw = finalMetrics.target_neighborhood ?? finalMetrics.targetNeighborhood
  if (!raw) return null
  return {
    connectivityRatio: raw.connectivityRatio ?? raw.connectivity_ratio,
    pdr: raw.pdr,
    throughputMbps: raw.throughputMbps ?? raw.throughput_mbps,
    delayMs: raw.delayMs ?? raw.delay_ms,
    count: raw.count ?? raw.sample_count,
  }
})
function normalizeMetricBucket(raw: any) {
  if (!raw) return null
  return {
    connectivityRatio: raw.connectivityRatio ?? raw.connectivity_ratio,
    pdr: raw.pdr,
    throughputMbps: raw.throughputMbps ?? raw.throughput_mbps ?? raw.throughput,
    delayMs: raw.delayMs ?? raw.delay_ms ?? raw.delay,
    count: raw.count ?? raw.sample_count ?? raw.num_samples ?? 0,
  }
}

const ncAttackPhaseRows = computed(() => {
  const phaseMetrics = ncAttackSummary.value?.phaseMetrics ?? ncAttackSummary.value?.phase_metrics
  if (!phaseMetrics || typeof phaseMetrics !== 'object') return []

  return ['pre_attack', 'immediate_post_attack', 'recovery', 'final']
    .map((phase) => {
      const bucket = phaseMetrics[phase]
      if (!bucket) return null
      const global = normalizeMetricBucket(bucket.global)
      const neighborhood = normalizeMetricBucket(bucket.target_neighborhood ?? bucket.targetNeighborhood)
      return global || neighborhood ? { phase, global, neighborhood } : null
    })
    .filter(Boolean) as Array<{ phase: string; global?: any; neighborhood?: any }>
})

/** 格式化 null 安全的时间值，避免将 null 显示为 0 */
function fmtTime(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return v.toFixed(2) + 's'
}

function fmtTargets(value: string | number[] | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.join('|')
  return String(value)
}

function fmtRecoveryScope(act: any): string {
  const targets = fmtTargets(act?.targetNodeIds)
  if (targets !== '—') return `目标 ${targets}`

  const scope = String(act?.scope ?? '').trim()
  if (scope.length > 0) return `范围 ${scope}`

  const policy = String(act?.effectiveRecoveryPolicy ?? act?.recoveryPolicy ?? '').trim()
  if (policy.includes('global')) return '范围 全局'
  if (policy.includes('local')) return '范围 局部'

  const actionType = String(act?.actionType ?? '').trim()
  if (actionType.includes('global')) return '范围 全局'
  if (actionType.includes('local')) return '范围 局部'

  return '范围 未指定'
}

function fmtCompactTime(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return `${Number(value).toFixed(1)}s`
}

function fmtRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return `${(Number(value) * 100).toFixed(1)}%`
}

const ncRecentObservedEvents = computed(() => {
  return [...ncObservedEvents.value]
    .map((item: any) => ({
      ...item,
      eventTime: Number(item.eventTime ?? item.time ?? 0),
      observedNodeId: Number(item.observedNodeId ?? item.nodeId ?? 0),
      avgRxPowerDbm: item.avgRxPowerDbm ?? item.power,
      channelId: item.channelId,
      signalDetected: item.signalDetected,
      missingReason: item.missingReason,
      noiseLevel: item.noiseLevel
    }))
    .sort((a: any, b: any) => b.eventTime - a.eventTime)
    .slice(0, 8)
})

const ncWindowSummary = computed(() => {
  return [...ncObservedWindows.value]
    .map((item: any) => ({
      ...item,
      observedNodeId: Number(item.observedNodeId ?? item.nodeId ?? 0),
      windowStart: Number(item.windowStart ?? 0),
      windowEnd: Number(item.windowEnd ?? 0),
      windowConfidence: Number(item.windowConfidence ?? 0),
      windowMissingRatio: Number(item.windowMissingRatio ?? 0),
      avgEvidenceStrength: Number(item.avgEvidenceStrength ?? 0)
    }))
    .sort((a: any, b: any) => (b.windowConfidence || 0) - (a.windowConfidence || 0))
    .slice(0, 6)
})

const ncLinkEvidenceTop = computed(() => {
  return [...ncLinkEvidence.value]
    .map((item: any) => ({
      ...item,
      srcObservedNodeId: Number(item.srcObservedNodeId ?? item.srcNode ?? 0),
      dstObservedNodeId: Number(item.dstObservedNodeId ?? item.dstNode ?? 0),
      edgeObservationConfidence: Number(item.edgeObservationConfidence ?? item.confidence ?? 0),
      evidenceStrength: Number(item.evidenceStrength ?? 0),
      dominantDirection: String(item.dominantDirection ?? item.evidenceType ?? '—')
    }))
    .sort((a: any, b: any) => (b.edgeObservationConfidence || 0) - (a.edgeObservationConfidence || 0))
    .slice(0, 8)
})

const ncInferredEdgesTop = computed(() => {
  return [...ncInferredEdges.value]
    .map((item: any) => ({
      ...item,
      srcObservedNodeId: Number(item.srcObservedNodeId ?? item.srcNode ?? 0),
      dstObservedNodeId: Number(item.dstObservedNodeId ?? item.dstNode ?? 0),
      edgeProbability: Number(item.edgeProbability ?? item.probability ?? 0),
      edgeConfidence: Number(item.edgeConfidence ?? item.confidence ?? 0),
      edgeDynamicState: String(item.edgeDynamicState ?? 'unknown'),
      dominantDirection: String(item.dominantDirection ?? '—')
    }))
    .sort((a: any, b: any) => (b.edgeProbability || 0) - (a.edgeProbability || 0))
    .slice(0, 8)
})

const ncKeyNodeBreakdown = computed(() => {
  return [...ncKeyNodes.value]
    .map((item: any) => ({
      ...item,
      nodeId: Number(item.nodeId ?? item.observedNodeId ?? 0),
      score: Number(item.score ?? item.keyNodeScore ?? 0),
      weightedDegreeScore: Number(item.weightedDegreeScore ?? 0),
      avgIncidentProbability: Number(item.avgIncidentProbability ?? 0),
      avgIncidentConfidence: Number(item.avgIncidentConfidence ?? 0),
      keyNodeMethod: String(item.keyNodeMethod ?? item.role ?? '—')
    }))
    .sort((a: any, b: any) => (a.rank ?? 999) - (b.rank ?? 999))
    .slice(0, 5)
})

const engine = inject<any>('engine')
const frame = computed(() => engine?.currentFrame?.value)
const qos = computed(() => frame.value?.QoS || { total_pdr: 0, throughput_mbps: 0, p99_latency_ms: 0 })

const pdrHistory = ref<number[]>([])
const tpHistory = ref<number[]>([])
const tickLabels = ref<number[]>([])
const MAX_HISTORY = 60

// 检测播放器循环回起点，清空积累的历史，避免短数据集的人为锯齿
const _currentTick = computed(() => engine?.currentTick?.value ?? 0)
watch(_currentTick, (newTick, oldTick) => {
  if (oldTick !== undefined && (oldTick as number) > 3 && newTick <= 1) {
    pdrHistory.value = []
    tpHistory.value = []
    tickLabels.value = []
  }
})

const pdrChartEl = ref<HTMLDivElement | null>(null)
const tpChartEl = ref<HTMLDivElement | null>(null)
const delayChartEl = ref<HTMLDivElement | null>(null)

// 非合作图表引用
const inferConfChartEl = ref<HTMLDivElement | null>(null)
const attackEffectChartEl = ref<HTMLDivElement | null>(null)

let pdrChart: echarts.ECharts | null = null
let tpChart: echarts.ECharts | null = null
let delayChart: echarts.ECharts | null = null

let inferConfChart: echarts.ECharts | null = null
let attackEffectChart: echarts.ECharts | null = null

const _tweenDelay = { value: 0 }

function ensureChartsReady() {
  if (pdrChartEl.value && !pdrChart) pdrChart = echarts.init(pdrChartEl.value)
  if (tpChartEl.value && !tpChart) tpChart = echarts.init(tpChartEl.value)
  if (delayChartEl.value && !delayChart) {
    delayChart = echarts.init(delayChartEl.value)
    delayChart.setOption(makeGaugeInitOption())
  }
  if (inferConfChartEl.value && !inferConfChart) inferConfChart = echarts.init(inferConfChartEl.value)
  if (attackEffectChartEl.value && !attackEffectChart) attackEffectChart = echarts.init(attackEffectChartEl.value)
}

watch(() => qos.value.p99_latency_ms, (raw) => {
  gsap.to(_tweenDelay, {
    value: raw || 0,
    duration: 0.3,
    ease: 'power2.out',
    onUpdate() {
      updateDelayGauge(Math.max(0, _tweenDelay.value))
    },
    onComplete() {
      updateDelayGauge(Math.max(0, _tweenDelay.value))
    }
  })
}, { immediate: true })

// ★ 图表option函数增加辅助线透明度，使图表在暗色下更易读
function makeLineOption(title: string, color: string, data: number[], labels: number[], unit: string = '', yRange?: [number, number]): echarts.EChartsOption {
  return {
    grid: { top: 30, right: 15, bottom: 20, left: 48 },
    title: {
      text: title,
      textStyle: {
        color: '#94a3b8',
        fontFamily: 'JetBrains Mono, Noto Sans SC, monospace',
        fontSize: 10,          // ★ 微大以增强可读性
        fontWeight: 'normal'
      },
      left: 4, top: 4
    },
    tooltip: {                  // ★ 新增: 悬浮提示
      trigger: 'axis',
      backgroundColor: 'rgba(8, 12, 32, 0.9)',
      borderColor: 'rgba(0, 242, 255, 0.2)',
      textStyle: {
        color: '#e2e8f0',
        fontFamily: 'JetBrains Mono, Noto Sans SC, monospace',
        fontSize: 11
      },
      axisPointer: {
        lineStyle: { color: 'rgba(0, 242, 255, 0.3)' }
      }
    },
    xAxis: {
      type: 'category', data: labels,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisLabel: { show: false }, axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      min: yRange ? yRange[0] : undefined,
      max: yRange ? yRange[1] : undefined,
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
      axisLabel: {
        color: '#64748b',
        fontSize: 9,
        fontFamily: 'JetBrains Mono, Noto Sans SC, monospace',
        formatter: (val: number) => `${val}${unit}`
      }
    },
    series: [{
      type: 'line', data, smooth: 0.4, symbol: 'none',  // ★ 定量平滑度
      lineStyle: {
        color,
        width: 2,
        shadowColor: color,
        shadowBlur: 12
      },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: color + '40' },   // ★ 面积渐变更柔和
          { offset: 0.6, color: color + '10' },
          { offset: 1, color: color + '02' }
        ])
      }
    }],
    animation: false
  }
}

function getDelayColor(v: number): string {
  if (v <= 200) return '#00ff88'    // 优秀
  if (v <= 500) return '#00f2ff'    // 正常
  if (v <= 1000) return '#facc15'   // 警告
  return '#ff3b3b'                  // 危险
}

function makeGaugeInitOption(): echarts.EChartsOption {
  const initColor = '#00f2ff'
  return {
    backgroundColor: 'transparent',
    animation: false,
    series: [
      {
        type: 'gauge', center: ['50%', '55%'], radius: '95%',
        startAngle: 220, endAngle: -40, min: 0, max: 2000,
        axisLine: { lineStyle: { width: 1, color: [[1, 'rgba(0,242,255,0.15)']] } },
        axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { show: false }, pointer: { show: false }, detail: { show: false }
      },
      {
        type: 'gauge', center: ['50%', '55%'], radius: '88%',
        startAngle: 220, endAngle: -40, min: 0, max: 2000,
        axisLine: {
          lineStyle: {
            width: 14,
            color: [[0.10, '#00ff88'], [0.25, '#00f2ff'], [0.50, '#facc15'], [1, '#ff3b3b']],
            shadowColor: 'rgba(0,242,255,0.3)', shadowBlur: 16
          }
        },
        axisTick: { distance: -20, length: 6, lineStyle: { color: 'rgba(255,255,255,0.2)', width: 1 } },
        splitLine: { distance: -24, length: 12, lineStyle: { color: 'rgba(255,255,255,0.4)', width: 2, shadowColor: 'rgba(0,242,255,0.5)', shadowBlur: 6 } },
        axisLabel: { distance: -32, color: '#64748b', fontSize: 8, fontFamily: 'JetBrains Mono, Noto Sans SC, monospace', formatter: (v: number) => v % 500 === 0 ? v + '' : '' },
        pointer: { show: false }, detail: { show: false }
      },
      {
        type: 'gauge', center: ['50%', '55%'], radius: '72%',
        startAngle: 220, endAngle: -40, min: 0, max: 2000,
        axisLine: { lineStyle: { width: 4, color: [[1, 'rgba(255,255,255,0.03)']] } },
        axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { show: false }, pointer: { show: false }, detail: { show: false },
        progress: {
          show: true, width: 4, roundCap: true,
          itemStyle: { color: initColor, shadowColor: initColor, shadowBlur: 12 }
        },
        data: [{ value: 0 }]
      },
      {
        type: 'gauge', center: ['50%', '55%'], radius: '80%',
        startAngle: 220, endAngle: -40, min: 0, max: 2000,
        itemStyle: { color: initColor, shadowColor: initColor, shadowBlur: 16 },
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { show: false }, axisLabel: { show: false },
        pointer: {
          icon: 'path://M-0.5,-80 L0.5,-80 L0.5,0 C0.5,0.28,-0.5,0.28,-0.5,0 Z',
          width: 3, length: '65%', offsetCenter: [0, 0],
          itemStyle: { color: initColor, shadowColor: initColor, shadowBlur: 10 }
        },
        anchor: {
          show: true, showAbove: true, size: 12,
          itemStyle: { borderWidth: 2, borderColor: initColor, color: '#0f172a', shadowColor: initColor, shadowBlur: 14 }
        },
        title: { show: true, offsetCenter: [0, '38%'], fontSize: 8, color: '#475569', fontFamily: 'JetBrains Mono, Noto Sans SC, monospace', fontWeight: 'normal' },
        detail: {
          valueAnimation: false,
          fontSize: 14, fontWeight: 'bold',
          fontFamily: "'JetBrains Mono','Noto Sans SC',monospace",
          offsetCenter: [0, '68%'],
          formatter: (v: number) => '{val|' + v.toFixed(1) + '}{unit| ms}',
          rich: {
            val: { fontSize: 14, fontWeight: 'bold', fontFamily: 'JetBrains Mono, Noto Sans SC, monospace', color: initColor, textShadowColor: initColor, textShadowBlur: 14, padding: [0, 2, 0, 0] },
            unit: { fontSize: 9, color: '#64748b', fontFamily: 'JetBrains Mono, Noto Sans SC, monospace', padding: [6, 0, 0, 2] }
          }
        },
        data: [{ value: 0, name: '' }]
      },
      {
        type: 'gauge', center: ['50%', '55%'], radius: '30%',
        startAngle: 0, endAngle: 360, min: 0, max: 1,
        axisLine: { lineStyle: { width: 1, color: [[1, 'rgba(0,242,255,0.08)']] } },
        axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { show: false }, pointer: { show: false }, detail: { show: false }
      }
    ]
  }
}

function updateDelayGauge(value: number) {
  if (!delayChart) return
  const c = getDelayColor(value)
  delayChart.setOption({
    series: [
      {},
      {},
      {
        progress: { itemStyle: { color: c, shadowColor: c } },
        data: [{ value }]
      },
      {
        itemStyle: { color: c, shadowColor: c },
        pointer: { itemStyle: { color: c, shadowColor: c } },
        anchor: { itemStyle: { borderColor: c, shadowColor: c } },
        detail: { rich: { val: { color: c, textShadowColor: c } } },
        data: [{ value, name: '' }]
      },
      {}
    ]
  })
}

// 非合作模式的简单条形图 mock 渲染
function makeBarOption(title: string, color: string, categories: string[], data: number[]): echarts.EChartsOption {
  return {
    grid: { top: 30, right: 15, bottom: 20, left: 40 },
    title: {
      text: title,
      textStyle: { color: '#94a3b8', fontSize: 10, fontFamily: 'monospace', fontWeight: 'normal' },
      left: 4, top: 4
    },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(8, 12, 32, 0.9)', borderColor: color, textStyle: { color: '#e2e8f0', fontSize: 11 } },
    xAxis: { type: 'category', data: categories, axisLabel: { color: '#64748b', fontSize: 9 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } }, axisLabel: { color: '#64748b', fontSize: 9 } },
    series: [{
      type: 'bar', data: data, barWidth: '40%',
      itemStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: color },
          { offset: 1, color: color + '40' }
        ]),
        borderRadius: [2, 2, 0, 0]
      }
    }]
  }
}

function updateCharts() {
  ensureChartsReady()

  if (!frame.value) {
    pdrHistory.value = []
    tpHistory.value = []
    tickLabels.value = []
    if (pdrChart) pdrChart.setOption(makeLineOption('PDR脉搏线 (%)', '#00f2ff', [], []))
    if (tpChart) tpChart.setOption(makeLineOption('吞吐量波浪 (Mbps)', '#a855f7', [], []))
    updateDelayGauge(0)
    return
  }

  const pdrValue = Number(qos.value.total_pdr)
  const throughputValue = Number(qos.value.throughput_mbps)
  const tickValue = Number(frame.value.tick)

  pdrHistory.value.push(Number.isFinite(pdrValue) ? pdrValue * 100 : 0)
  tpHistory.value.push(Number.isFinite(throughputValue) ? throughputValue : 0)
  tickLabels.value.push(Number.isFinite(tickValue) ? tickValue : 0)
  if (pdrHistory.value.length > MAX_HISTORY) {
    pdrHistory.value.shift()
    tpHistory.value.shift()
    tickLabels.value.shift()
  }

  if (currentAppMode.value === 'cooperative') {
    if (pdrChart) pdrChart.setOption(makeLineOption('PDR脉搏线 (%)', '#00f2ff', pdrHistory.value, tickLabels.value, '%', [0, 100]))
    if (tpChart) tpChart.setOption(makeLineOption('吞吐量波浪 (Mbps)', '#a855f7', tpHistory.value, tickLabels.value, 'M'))
    pdrChart?.resize()
    tpChart?.resize()
  } else {
    if (inferConfChart) {
      inferConfChart.setOption(
        makeBarOption(
          '推断核心节点可信度 (%)',
          '#facc15',
          ncInferChartData.value.map(item => item.label),
          ncInferChartData.value.map(item => item.value)
        )
      )
    }
    if (attackEffectChart) {
      attackEffectChart.setOption(
        makeLineOption(
          '打击效能评估 (连通率)',
          '#ff3b3b',
          ncAttackEffectSeries.value.map(item => item.connectivity),
          ncAttackEffectSeries.value.map(item => item.time),
          '%',
          [0, 100]
        )
      )
    }
  }
}

function initCharts() {
  ensureChartsReady()
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
      inferConfChart?.resize()
      attackEffectChart?.resize()
    })
    if (panelRef.value) resizeOb.observe(panelRef.value)
  }, 200)
})

onBeforeUnmount(() => {
  pdrChart?.dispose()
  tpChart?.dispose()
  delayChart?.dispose()
  inferConfChart?.dispose()
  attackEffectChart?.dispose()
  resizeOb?.disconnect()
})

watch(frame, updateCharts, { deep: true })
watch([ncKeyNodes, ncAttackEffectMetrics, currentAppMode, currentScene], updateCharts, { deep: true })
watch(currentAppMode, async () => {
  await nextTick()
  setTimeout(() => {
    ensureChartsReady()
    updateCharts()
    pdrChart?.resize()
    tpChart?.resize()
    delayChart?.resize()
    inferConfChart?.resize()
    attackEffectChart?.resize()
  }, 50)
})
watch(currentScene, async () => {
  await nextTick()
  setTimeout(() => {
    ensureChartsReady()
    updateCharts()
    pdrChart?.resize()
    tpChart?.resize()
    delayChart?.resize()
    inferConfChart?.resize()
    attackEffectChart?.resize()
  }, 50)
})
</script>

<template>
  <aside ref="panelRef" class="right-panel">
    
    <!-- 合作模式专属分析 -->
    <template v-if="currentAppMode === 'cooperative'">
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
        <div class="gauge-status-bar">
          <span class="status-dot" :class="{
            'dot-green': qos.p99_latency_ms <= 200,
            'dot-cyan': qos.p99_latency_ms > 200 && qos.p99_latency_ms <= 500,
            'dot-yellow': qos.p99_latency_ms > 500 && qos.p99_latency_ms <= 1000,
            'dot-red': qos.p99_latency_ms > 1000
          }"></span>
          <span class="gauge-label">P99 延迟监测</span>
          <span class="gauge-zone" :class="{
            'zone-safe': qos.p99_latency_ms <= 200,
            'zone-normal': qos.p99_latency_ms > 200 && qos.p99_latency_ms <= 500,
            'zone-warn': qos.p99_latency_ms > 500 && qos.p99_latency_ms <= 1000,
            'zone-crit': qos.p99_latency_ms > 1000
          }">
            {{ qos.p99_latency_ms <= 200 ? '安全' : qos.p99_latency_ms <= 500 ? '正常' : qos.p99_latency_ms <= 1000 ? '预警' : '危急' }}
          </span>
        </div>
        <div ref="delayChartEl" id="delay-gauge" class="echart-box gauge-box"></div>
      </div>
      <!-- ★ 合作模式恢复总览卡片 -->
      <div v-if="coopDashboard" class="glass-panel chart-card">
        <div class="section-title">恢复总览</div>
        <div class="coop-dashboard">
          <div class="dash-row">
            <span class="dash-label">通信架构</span>
            <span class="dash-value">{{ coopDashboard.communicationMode || coopModeSummary?.communicationMode || '—' }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">恢复状态</span>
            <span class="dash-value" :class="['completed', 'stable', 'recovered'].includes(coopDashboard.recoveryStatus) ? 'val-green' : coopDashboard.recoveryStatus === 'active' ? 'val-yellow' : 'val-red'">{{ coopDashboard.recoveryStatus || '—' }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">当前阶段</span>
            <span class="dash-value">{{ coopDashboard.phase || '—' }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">当前 Leader</span>
            <span class="dash-value">Node {{ coopDashboard.leaderNodeId ?? '—' }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">备份 Leader</span>
            <span class="dash-value">{{ coopDashboard.backupLeaderId != null ? `Node ${coopDashboard.backupLeaderId}` : '—' }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">故障类型</span>
            <span class="dash-value">{{ coopDashboard.failureType || coopModeSummary?.failureType || '—' }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">故障目标</span>
            <span class="dash-value">{{ coopDashboard.failureTargetId != null ? `Node ${coopDashboard.failureTargetId}` : '—' }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">响应时间</span>
            <span class="dash-value">{{ fmtTime(coopResponseTimeSec) }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">恢复时间</span>
            <span class="dash-value">{{ fmtTime(coopRecoveryTimeSec) }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">稳定时间</span>
            <span class="dash-value">{{ fmtTime(coopStabilizationTimeSec) }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">领队存活</span>
            <span class="dash-value" :class="coopDashboard.isLeaderAlive ? 'val-green' : 'val-red'">{{ coopDashboard.isLeaderAlive ? '是' : '否' }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">故障活跃</span>
            <span class="dash-value" :class="coopDashboard.failureActive ? 'val-red' : 'val-green'">{{ coopDashboard.failureActive ? '是' : '否' }}</span>
          </div>
        </div>
      </div>

      <div v-if="coopDashboard" class="glass-panel chart-card">
        <div class="section-title">恢复压力</div>
        <div class="coop-dashboard">
          <div class="dash-row">
            <span class="dash-label">路由切换累计</span>
            <span class="dash-value">{{ Number(coopDashboard?.routeChangeCount ?? coopDerivedMetricSnapshot?.routeChangeCount ?? 0).toFixed(0) }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">中继切换累计</span>
            <span class="dash-value">{{ Number(coopDashboard?.relaySwitchCount ?? coopDerivedMetricSnapshot?.relaySwitchCount ?? 0).toFixed(0) }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">控制超时累计</span>
            <span class="dash-value" :class="Number(coopDashboard?.controlDeadlineMissCount ?? coopDerivedMetricSnapshot?.controlDeadlineMissCount ?? 0) > 0 ? 'val-red' : 'val-green'">{{ Number(coopDashboard?.controlDeadlineMissCount ?? coopDerivedMetricSnapshot?.controlDeadlineMissCount ?? 0).toFixed(0) }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">路由压力分</span>
            <span class="dash-value" :class="Number(coopDashboard?.routePressureScore ?? coopDerivedMetricSnapshot?.routePressureScore ?? 0) >= 0.6 ? 'val-red' : Number(coopDashboard?.routePressureScore ?? coopDerivedMetricSnapshot?.routePressureScore ?? 0) >= 0.3 ? 'val-yellow' : 'val-green'">{{ ((Number(coopDashboard?.routePressureScore ?? coopDerivedMetricSnapshot?.routePressureScore ?? 0)) * 100).toFixed(0) }}%</span>
          </div>
        </div>
      </div>

      <div v-if="coopDashboard" class="glass-panel chart-card">
        <div class="section-title">故障邻域快照</div>
        <div class="coop-dashboard">
          <div class="dash-row">
            <span class="dash-label">邻域规模</span>
            <span class="dash-value">{{ Number(coopDerivedMetricSnapshot?.failureNeighborhoodNodeCount ?? 0).toFixed(0) }} 节点</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">邻域 PDR</span>
            <span class="dash-value">{{ coopDerivedMetricSnapshot?.failureNeighborhoodPdr != null ? ((Number(coopDerivedMetricSnapshot.failureNeighborhoodPdr) * 100).toFixed(1) + '%') : '—' }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">邻域吞吐</span>
            <span class="dash-value">{{ coopDerivedMetricSnapshot?.failureNeighborhoodThroughputMbps != null ? (Number(coopDerivedMetricSnapshot.failureNeighborhoodThroughputMbps).toFixed(2) + ' Mbps') : '—' }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">邻域时延</span>
            <span class="dash-value">{{ coopDerivedMetricSnapshot?.failureNeighborhoodDelayMs != null ? (Number(coopDerivedMetricSnapshot.failureNeighborhoodDelayMs).toFixed(1) + ' ms') : '—' }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">故障目标状态</span>
            <span class="dash-value" :class="coopDerivedMetricSnapshot?.isFailureTargetFailed ? 'val-red' : 'val-green'">{{ coopDerivedMetricSnapshot?.isFailureTargetFailed ? '已失效' : '仍活跃' }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">目标节点 PDR</span>
            <span class="dash-value">{{ coopDerivedMetricSnapshot?.failureTargetPdr != null ? ((Number(coopDerivedMetricSnapshot.failureTargetPdr) * 100).toFixed(1) + '%') : '—' }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">目标节点时延</span>
            <span class="dash-value">{{ coopDerivedMetricSnapshot?.failureTargetDelayMs != null ? (Number(coopDerivedMetricSnapshot.failureTargetDelayMs).toFixed(1) + ' ms') : '—' }}</span>
          </div>
        </div>
      </div>

      <!-- ★ 故障/恢复事件时间线 -->
      <div v-if="coopDashboard" class="glass-panel chart-card">
        <div class="section-title">事件时间线</div>
        <div class="event-timeline">
          <div v-for="(evt, i) in coopFailureEvents.slice(0, 5)" :key="'f'+i" class="timeline-item failure-item">
            <span class="tl-time">{{ evt.time?.toFixed(1) }}s</span>
            <span class="tl-dot red-dot"></span>
            <span class="tl-text">故障 {{ evt.failureType }} 命中 Node {{ evt.targetNodeId }} / {{ evt.targetRole || 'unknown' }}，状态 {{ evt.failureState || '—' }}，影响邻居 {{ evt.affectedNeighborCount ?? 0 }}、链路 {{ evt.affectedLinkCount ?? 0 }}。{{ evt.effectSummary || '' }}</span>
          </div>
          <div v-for="(act, i) in coopRecoveryActions.slice(0, 8)" :key="'r'+i" class="timeline-item recovery-item">
            <span class="tl-time">{{ act.time?.toFixed(1) }}s</span>
            <span class="tl-dot green-dot"></span>
            <span class="tl-text">{{ act.actionType }} / 执行节点 {{ act.executorNodeId ?? '—' }} / {{ fmtRecoveryScope(act) }} / 原因 {{ act.triggerReason || '—' }} / 结果 {{ act.resultState || '—' }}</span>
          </div>
          <div v-if="coopFailureEvents.length === 0 && coopRecoveryActions.length === 0" class="timeline-item">
            <span class="tl-time">—</span>
            <span class="tl-dot cyan-dot"></span>
            <span class="tl-text">合作模式时间线结果暂未展开到右栏，当前任务仍在恢复阶段。</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 非合作模式专属分析 -->
    <template v-else>
      <div class="glass-panel chart-card infer-obs-card">
        <div class="section-title">观测质量评测</div>
        <div class="obs-metrics" style="display:flex; justify-content:space-around; padding: 10px 0;">
          <div style="text-align:center;">
             <div style="color:#00f2ff; font-size:18px; font-weight:bold;">{{ ncObservedEvents.length || '—' }}</div>
             <div style="font-size:10px; color:#64748b;">观测事件数</div>
          </div>
          <div style="text-align:center;">
             <div style="color:#10b981; font-size:18px; font-weight:bold;">{{ ncObservedWindows.length || '—' }}</div>
             <div style="font-size:10px; color:#64748b;">观测窗口数</div>
          </div>
          <div style="text-align:center;">
             <div style="color:#facc15; font-size:18px; font-weight:bold;">{{ ncLinkEvidence.length || '—' }}</div>
             <div style="font-size:10px; color:#64748b;">边证据数</div>
          </div>
          <div style="text-align:center;">
             <div style="color:#a855f7; font-size:18px; font-weight:bold;">{{ ncInferredEdges.length || '—' }}</div>
             <div style="font-size:10px; color:#64748b;">推断拓扑边</div>
          </div>
          <div style="text-align:center;">
             <div style="color:#ff3b3b; font-size:18px; font-weight:bold;">{{ ncInferredNodes.length || '—' }}</div>
             <div style="font-size:10px; color:#64748b;">推断隐匿节点</div>
          </div>
        </div>
      </div>

      <div v-if="ncRecentObservedEvents.length > 0" class="glass-panel chart-card">
        <div class="section-title">最近观测事件</div>
        <div class="event-timeline">
          <div v-for="(evt, i) in ncRecentObservedEvents" :key="'obs-'+i" class="timeline-item">
            <span class="tl-time">{{ fmtCompactTime(evt.eventTime) }}</span>
            <span class="tl-dot" :class="evt.signalDetected === false ? 'red-dot' : 'cyan-dot'"></span>
            <span class="tl-text">ObsNode {{ evt.observedNodeId }} / {{ evt.avgRxPowerDbm != null ? `${Number(evt.avgRxPowerDbm).toFixed(1)} dBm` : '功率无回传' }} / CH{{ evt.channelId ?? '—' }} / {{ evt.signalDetected === false ? `漏检 ${evt.missingReason || 'unknown'}` : '信号已捕获' }}</span>
          </div>
        </div>
      </div>

      <div v-if="ncWindowSummary.length > 0" class="glass-panel chart-card">
        <div class="section-title">观测窗口摘要</div>
        <div class="key-nodes-list">
          <div v-for="(win, i) in ncWindowSummary" :key="'win-'+i" class="kn-row" :style="{ borderLeftColor: '#10b981' }">
            <span class="kn-rank">{{ fmtCompactTime(win.windowStart) }}</span>
            <span class="kn-id">ObsNode {{ win.observedNodeId }}</span>
            <span class="kn-score" style="color:#10b981">{{ fmtRatio(win.windowConfidence) }}</span>
          </div>
        </div>
        <div class="coop-dashboard">
          <div v-for="(win, i) in ncWindowSummary.slice(0, 3)" :key="'ws-'+i" class="dash-row">
            <span class="dash-label">{{ fmtCompactTime(win.windowStart) }} - {{ fmtCompactTime(win.windowEnd) }}</span>
            <span class="dash-value">漏检 {{ fmtRatio(win.windowMissingRatio) }} / 证据 {{ fmtRatio(win.avgEvidenceStrength) }}</span>
          </div>
        </div>
      </div>

      <div v-if="ncLinkEvidenceTop.length > 0" class="glass-panel chart-card">
        <div class="section-title">链路证据 Top-N</div>
        <div class="event-timeline">
          <div v-for="(edge, i) in ncLinkEvidenceTop" :key="'evi-'+i" class="timeline-item">
            <span class="tl-time">{{ fmtCompactTime(edge.windowStart ?? edge.observedTime) }}</span>
            <span class="tl-dot yellow-dot"></span>
            <span class="tl-text">ObsNode {{ edge.srcObservedNodeId }} ↔ {{ edge.dstObservedNodeId }} / 证据 {{ fmtRatio(edge.evidenceStrength) }} / 置信 {{ fmtRatio(edge.edgeObservationConfidence) }} / 主方向 {{ edge.dominantDirection }}</span>
          </div>
        </div>
      </div>

      <div v-if="ncInferredEdgesTop.length > 0" class="glass-panel chart-card">
        <div class="section-title">推断拓扑边</div>
        <div class="event-timeline">
          <div v-for="(edge, i) in ncInferredEdgesTop" :key="'inf-'+i" class="timeline-item">
            <span class="tl-time">{{ fmtCompactTime(edge.windowStart) }}</span>
            <span class="tl-dot" :class="edge.edgeProbability >= 0.75 ? 'green-dot' : edge.edgeProbability >= 0.45 ? 'yellow-dot' : 'red-dot'"></span>
            <span class="tl-text">ObsNode {{ edge.srcObservedNodeId }} → {{ edge.dstObservedNodeId }} / 概率 {{ fmtRatio(edge.edgeProbability) }} / 置信 {{ fmtRatio(edge.edgeConfidence) }} / {{ edge.edgeDynamicState }} / {{ edge.dominantDirection }}</span>
          </div>
        </div>
      </div>

      <!-- ★ 推断节点网络 -->
      <div v-if="ncInferredNodesTop.length > 0" class="glass-panel chart-card">
        <div class="section-title">隐匿节点推断 (Top-{{ Math.min(ncInferredNodesTop.length, 10) }})</div>
        <div class="key-nodes-list">
          <div v-for="(node, i) in ncInferredNodesTop" :key="'infnode-'+i" class="kn-row" :style="{ borderLeftColor: '#a855f7' }">
            <span class="kn-rank">#{{ i+1 }}</span>
            <span class="kn-id">Node {{ node.nodeId }}</span>
            <span class="kn-score" style="font-weight:normal; font-size:10px;">{{ node.inferredRole }} / 置信 {{ fmtRatio(node.roleConfidence) }} <span v-if="node.anomalyScore > 0">/ 异常 {{ fmtRatio(node.anomalyScore) }}</span></span>
          </div>
        </div>
      </div>

      <!-- ★ 关键节点候选列表 -->
      <div v-if="ncKeyNodes.length > 0" class="glass-panel chart-card">
        <div class="section-title">关键节点识别 (Top-{{ Math.min(ncKeyNodes.length, 10) }})</div>
        <div class="key-nodes-list">
          <div v-for="(kn, i) in ncKeyNodes.slice(0, 10)" :key="kn.nodeId" class="kn-row" :style="{ borderLeftColor: i < 3 ? '#ff3b3b' : i < 6 ? '#facc15' : '#00f2ff' }">
            <span class="kn-rank">#{{ kn.rank ?? (i+1) }}</span>
            <span class="kn-id">Node {{ kn.nodeId }}</span>
            <span class="kn-score" :style="{ color: i < 3 ? '#ff3b3b' : '#00f2ff' }">{{ (kn.score * 100).toFixed(1) }}%</span>
          </div>
        </div>
      </div>

      <div v-if="ncKeyNodeBreakdown.length > 0" class="glass-panel chart-card">
        <div class="section-title">关键节点拆解</div>
        <div class="coop-dashboard">
          <div v-for="(node, i) in ncKeyNodeBreakdown" :key="'break-'+i" class="dash-block">
            <div class="dash-row">
              <span class="dash-label">Node {{ node.nodeId }} / #{{ node.rank ?? i + 1 }}</span>
              <span class="dash-value" :style="{ color: i === 0 ? '#ff3b3b' : '#00f2ff' }">{{ fmtRatio(node.score) }}</span>
            </div>
            <div class="dash-row subtle-row">
              <span class="dash-label">加权度</span>
              <span class="dash-value">{{ fmtRatio(node.weightedDegreeScore) }}</span>
            </div>
            <div class="dash-row subtle-row">
              <span class="dash-label">关联边概率</span>
              <span class="dash-value">{{ fmtRatio(node.avgIncidentProbability) }}</span>
            </div>
            <div class="dash-row subtle-row">
              <span class="dash-label">关联边置信</span>
              <span class="dash-value">{{ fmtRatio(node.avgIncidentConfidence) }}</span>
            </div>
            <div class="dash-row subtle-row">
              <span class="dash-label">方法</span>
              <span class="dash-value">{{ node.keyNodeMethod }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 推断可信度图 -->
      <div class="glass-panel chart-card">
        <div ref="inferConfChartEl" id="infer-conf-chart" class="echart-box"></div>
      </div>

      <!-- 打击效能评估图 -->
      <div class="glass-panel chart-card">
        <div ref="attackEffectChartEl" id="attack-effect-chart" class="echart-box"></div>
      </div>

      <!-- ★ 打击闭环结果区域 -->
      <template v-if="hasAttackResults">
        <!-- 推荐打击目标 -->
        <div v-if="ncAttackRecommendations.length > 0" class="glass-panel chart-card">
          <div class="section-title" style="color:#ff6b6b;">推荐打击目标</div>
          <div class="key-nodes-list">
            <div v-for="(rec, i) in ncAttackRecommendations.slice(0, 5)" :key="i" class="kn-row" :style="{ borderLeftColor: i === 0 ? '#ff3b3b' : '#facc15' }">
              <span class="kn-rank">#{{ rec.recommendationRank ?? (i+1) }}</span>
              <span class="kn-id">ObsNode {{ rec.recommendedObservedNodeId }}</span>
              <span class="kn-score" :style="{ color: i === 0 ? '#ff3b3b' : '#facc15' }">{{ (rec.recommendedScore * 100).toFixed(1) }}%</span>
            </div>
          </div>
          <div v-if="ncAttackRecommendations[0]" class="coop-dashboard">
            <div class="dash-row subtle-row">
              <span class="dash-label">推荐理由</span>
              <span class="dash-value">{{ ncAttackRecommendations[0].recommendationReason || '—' }}</span>
            </div>
            <div class="dash-row subtle-row">
              <span class="dash-label">结构分 / 证据分</span>
              <span class="dash-value">{{ fmtRatio(ncAttackRecommendations[0].structureScore) }} / {{ fmtRatio(ncAttackRecommendations[0].evidenceSupportScore) }}</span>
            </div>
            <div class="dash-row subtle-row">
              <span class="dash-label">因果分 / 损伤分</span>
              <span class="dash-value">{{ fmtRatio(ncAttackRecommendations[0].causalSupportScore) }} / {{ fmtRatio(ncAttackRecommendations[0].postRemovalDamageScore) }}</span>
            </div>
          </div>
        </div>

        <!-- 打击计划摘要 -->
        <div v-if="ncAttackPlan" class="glass-panel chart-card">
          <div class="section-title" style="color:#ff6b6b;">打击计划摘要</div>
          <div class="coop-dashboard">
            <div class="dash-row">
              <span class="dash-label">打击类型</span>
              <span class="dash-value">{{ ncAttackPlan.attackType || 'node_strike' }}</span>
            </div>
            <div class="dash-row">
              <span class="dash-label">推荐目标</span>
              <span class="dash-value">Node {{ ncAttackPlan.recommendedObservedNodeId }}</span>
            </div>
            <div class="dash-row">
              <span class="dash-label">确认目标</span>
              <span class="dash-value">Node {{ ncAttackPlan.confirmedObservedNodeId }}</span>
            </div>
            <div class="dash-row">
              <span class="dash-label">绑定状态</span>
              <span class="dash-value" :class="ncAttackPlan.targetBindingStatus === 'confirmed' ? 'val-green' : 'val-yellow'">{{ ncAttackPlan.targetBindingStatus || '—' }}</span>
            </div>
            <div class="dash-row">
              <span class="dash-label">打击时间</span>
              <span class="dash-value">{{ fmtTime(ncAttackPlan.attackExecuteTime) }}</span>
            </div>
            <div v-if="ncAttackPlan.strikeExecuteTime != null" class="dash-row">
              <span class="dash-label">真实执行时刻</span>
              <span class="dash-value">{{ fmtTime(ncAttackPlan.strikeExecuteTime) }}</span>
            </div>
            <div v-if="ncAttackPlan.strikeMode" class="dash-row">
              <span class="dash-label">执行模式</span>
              <span class="dash-value">{{ ncAttackPlan.strikeMode }}</span>
            </div>
            <div v-if="ncAttackPlan.executedObservedNodeId != null" class="dash-row">
              <span class="dash-label">最终执行观测目标</span>
              <span class="dash-value">Node {{ ncAttackPlan.executedObservedNodeId }}</span>
            </div>
            <div v-if="ncAttackPlan.executedEntityNodeId != null" class="dash-row">
              <span class="dash-label">实际命中实体</span>
              <span class="dash-value" style="color:#ff3b3b;">Entity {{ ncAttackPlan.executedEntityNodeId }}</span>
            </div>
            <div v-if="ncAttackPlan.evaluationWindowStart != null && ncAttackPlan.evaluationWindowEnd != null" class="dash-row">
              <span class="dash-label">评估窗口</span>
              <span class="dash-value">{{ fmtTime(ncAttackPlan.evaluationWindowStart) }} - {{ fmtTime(ncAttackPlan.evaluationWindowEnd) }}</span>
            </div>
            <div v-if="ncAttackPlan.targetNeighborhoodSize != null" class="dash-row">
              <span class="dash-label">邻域规模</span>
              <span class="dash-value">{{ ncAttackPlan.targetNeighborhoodSize }} 节点</span>
            </div>
          </div>
        </div>

        <div v-if="ncLatestTargetBinding" class="glass-panel chart-card">
          <div class="section-title" style="color:#ff6b6b;">目标绑定结果</div>
          <div class="coop-dashboard">
            <div class="dash-row">
              <span class="dash-label">观测目标</span>
              <span class="dash-value">ObsNode {{ ncLatestTargetBinding.observedNodeId }}</span>
            </div>
            <div class="dash-row">
              <span class="dash-label">绑定状态</span>
              <span class="dash-value" :class="['confirmed', 'binding_success', 'stable'].includes(ncLatestTargetBinding.bindingStatus) ? 'val-green' : 'val-yellow'">{{ ncLatestTargetBinding.bindingStatus || '—' }}</span>
            </div>
            <div class="dash-row">
              <span class="dash-label">绑定置信度</span>
              <span class="dash-value">{{ fmtRatio(ncLatestTargetBinding.bindingConfidence) }}</span>
            </div>
            <div class="dash-row">
              <span class="dash-label">轨迹状态</span>
              <span class="dash-value">{{ ncLatestTargetBinding.isTrackStable ? '稳定' : '不稳定' }} / {{ ncLatestTargetBinding.isTrackActive ? '活跃' : '失活' }}</span>
            </div>
            <div class="dash-row">
              <span class="dash-label">实体目标</span>
              <span class="dash-value">{{ ncLatestTargetBinding.executedEntityNodeId != null ? `Entity ${ncLatestTargetBinding.executedEntityNodeId}` : '—' }}</span>
            </div>
            <div class="dash-row">
              <span class="dash-label">真实关键目标</span>
              <span class="dash-value" :class="ncLatestTargetBinding.isTrueCriticalTarget ? 'val-green' : 'val-red'">{{ ncLatestTargetBinding.isTrueCriticalTarget ? '是' : '否' }}</span>
            </div>
            <div class="dash-row" v-if="ncLatestTargetBinding.mismatchType">
              <span class="dash-label">误配类型</span>
              <span class="dash-value">{{ ncLatestTargetBinding.mismatchType }}</span>
            </div>
          </div>
        </div>

        <!-- 打击事件时间线 -->
        <div v-if="ncAttackEvents.length > 0" class="glass-panel chart-card">
          <div class="section-title" style="color:#ff6b6b;">打击事件时间线</div>
          <div class="event-timeline">
            <div v-for="(evt, i) in ncAttackEvents.slice(0, 8)" :key="i" class="timeline-item failure-item">
              <span class="tl-time">{{ evt.eventTime?.toFixed(1) }}s</span>
              <span class="tl-dot" :class="evt.isTrueTargetHit ? 'green-dot' : 'red-dot'"></span>
              <span class="tl-text">
                {{ evt.attackType }} / 推荐 ObsNode {{ evt.recommendedObservedNodeId }} / 执行 ObsNode {{ evt.executedObservedNodeId }} / 实体 {{ evt.executedEntityNodeId ?? '—' }} / {{ evt.nodeRemoved ? '节点已移除' : '未移除' }}
                <span v-if="evt.isTrueTargetHit" style="color:#00ff88;"> ✓ 命中真实关键目标</span>
                <span v-else style="color:#ff3b3b;"> ✗ {{ evt.targetMismatchType || '未命中' }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- 打击前后对比摘要 -->
        <div v-if="ncAttackSummary" class="glass-panel chart-card">
          <div class="section-title" style="color:#ff6b6b;">打击效果评估</div>
          <div class="coop-dashboard">
            <template v-if="ncAttackGlobalFinalMetrics">
              <div class="dash-row">
                <span class="dash-label">全局最终连通率</span>
                <span class="dash-value">{{ fmtRatio(ncAttackGlobalFinalMetrics.connectivityRatio) }}</span>
              </div>
              <div class="dash-row">
                <span class="dash-label">全局最终 PDR</span>
                <span class="dash-value">{{ fmtRatio(ncAttackGlobalFinalMetrics.pdr) }}</span>
              </div>
              <div class="dash-row">
                <span class="dash-label">全局最终吞吐</span>
                <span class="dash-value">{{ Number(ncAttackGlobalFinalMetrics.throughputMbps ?? 0).toFixed(2) }} Mbps</span>
              </div>
              <div class="dash-row">
                <span class="dash-label">全局最终时延</span>
                <span class="dash-value">{{ Number(ncAttackGlobalFinalMetrics.delayMs ?? 0).toFixed(1) }} ms</span>
              </div>
            </template>
            <template v-if="ncAttackNeighborhoodFinalMetrics">
              <div class="dash-row">
                <span class="dash-label">目标邻域连通率</span>
                <span class="dash-value">{{ fmtRatio(ncAttackNeighborhoodFinalMetrics.connectivityRatio) }}</span>
              </div>
              <div class="dash-row">
                <span class="dash-label">目标邻域 PDR</span>
                <span class="dash-value">{{ fmtRatio(ncAttackNeighborhoodFinalMetrics.pdr) }}</span>
              </div>
            </template>
            <template v-if="ncAttackSummary.recoverySummary || ncAttackSummary.recovery_summary">
              <div class="dash-row">
                <span class="dash-label">恢复进度</span>
                <span class="dash-value" :class="(Number(ncAttackSummary.recoverySummary?.recoveryProgress ?? ncAttackSummary.recovery_summary?.recovery_progress ?? 0)) >= 0.8 ? 'val-green' : 'val-yellow'">
                  {{ ((Number(ncAttackSummary.recoverySummary?.recoveryProgress ?? ncAttackSummary.recovery_summary?.recovery_progress ?? 0)) * 100).toFixed(0) }}%
                </span>
              </div>
              <div class="dash-row">
                <span class="dash-label">损伤持续</span>
                <span class="dash-value">{{ fmtTime(ncAttackSummary.recoverySummary?.damageDuration ?? ncAttackSummary.recovery_summary?.damage_duration) }}</span>
              </div>
              <div class="dash-row" v-if="(ncAttackSummary.recoverySummary?.actualAttackExecutionTime ?? ncAttackSummary.recovery_summary?.actual_attack_execution_time) != null">
                <span class="dash-label">真实执行时刻</span>
                <span class="dash-value">{{ fmtTime(ncAttackSummary.recoverySummary?.actualAttackExecutionTime ?? ncAttackSummary.recovery_summary?.actual_attack_execution_time) }}</span>
              </div>
              <div class="dash-row" v-if="(ncAttackSummary.recoverySummary?.recoveryCompletedAt ?? ncAttackSummary.recovery_summary?.recovery_completed_at) != null">
                <span class="dash-label">恢复完成时刻</span>
                <span class="dash-value">{{ fmtTime(ncAttackSummary.recoverySummary?.recoveryCompletedAt ?? ncAttackSummary.recovery_summary?.recovery_completed_at) }}</span>
              </div>
            </template>
          </div>
        </div>

        <div v-if="ncAttackPhaseRows.length > 0" class="glass-panel chart-card">
          <div class="section-title" style="color:#ff6b6b;">分阶段效果快照</div>
          <div class="coop-dashboard">
            <div v-for="row in ncAttackPhaseRows" :key="row.phase" class="dash-block">
              <div class="dash-row">
                <span class="dash-label">{{ row.phase }}</span>
                <span class="dash-value">{{ row.global?.count ?? row.neighborhood?.count ?? 0 }} 样本</span>
              </div>
              <div class="dash-row subtle-row" v-if="row.global">
                <span class="dash-label">全局连通 / PDR</span>
                <span class="dash-value">{{ fmtRatio(row.global.connectivityRatio) }} / {{ fmtRatio(row.global.pdr) }}</span>
              </div>
              <div class="dash-row subtle-row" v-if="row.neighborhood">
                <span class="dash-label">邻域连通 / PDR</span>
                <span class="dash-value">{{ fmtRatio(row.neighborhood.connectivityRatio) }} / {{ fmtRatio(row.neighborhood.pdr) }}</span>
              </div>
              <div class="dash-row subtle-row" v-if="row.global">
                <span class="dash-label">全局吞吐 / 时延</span>
                <span class="dash-value">{{ Number(row.global.throughputMbps ?? 0).toFixed(2) }} Mbps / {{ Number(row.global.delayMs ?? 0).toFixed(1) }} ms</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

  </aside>
</template>

<style scoped>
.right-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
  overflow-y: auto !important;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding-left: 4px;
}

/* 拓扑演化核心组件样式 */
.topo-card {
  padding: 14px;
  flex-shrink: 0;
  border-left: 2px solid var(--cyan);          /* ★ 始终显示 */
  transition: border-color 0.5s ease;
}

.topo-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.topo-pulse {
  width: 8px; height: 8px; border-radius: 50%;
  box-shadow: 0 0 8px currentColor;
  animation: pulse-dot 1s infinite;
}

.topo-content {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 12px;
}

.topo-core {
  position: relative;
  width: 90px; height: 90px;
  display: flex; justify-content: center; align-items: center;
}

.core-ring {
  width: 100%; height: 100%;
  transform: rotate(-90deg);
}

.core-val {
  position: absolute;
  font-family: var(--font-display);
  font-weight: 700; font-size: 18px;
  text-shadow: 0 0 10px currentColor;
}
.core-val .pct { font-size: 10px; opacity: 0.8; }

.core-label {
  position: absolute; bottom: 18px;
  font-size: 7px; color: rgba(255,255,255,0.5);
  letter-spacing: 1px;
}

.topo-stats {
  flex: 1;
  display: flex; flex-direction: column; gap: 6px;
}

.stat-row {
  display: flex; justify-content: space-between; align-items: flex-end;
}
.stat-row .label { font-size: 10px; color: var(--text-dim); }
.stat-row .val { font-family: var(--font-mono); font-size: 16px; font-weight: bold; }
.stat-row .sub { font-size: 9px; opacity: 0.7; }

.link-power-bar-wrapper {
  position: relative;
  height: 6px; width: 100%;
  background: rgba(0,0,0,0.5);
  border-radius: 2px; overflow: hidden;
  border: 1px solid rgba(255,255,255,0.1);
}

.power-fill {
  height: 100%;
  transition: width 0.3s ease-out, background-color 0.3s;
}

.power-grid-overlay {
  position: absolute; top:0; left:0; right:0; bottom:0;
  background-image: linear-gradient(90deg, transparent 50%, rgba(0,0,0,0.8) 50%);
  background-size: 4px 100%;
  opacity: 0.3;
}

.status-msg {
  font-size: 10px; text-align: right; margin-top: 2px;
  font-family: var(--font-mono);
}

.spin-slow {
  transform-origin: 50% 50%;
  animation: spin 20s linear infinite;       /* ★ 从 8s 减速到 20s */
}

@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes pulse-dot { 0%, 100% { opacity: 0.5; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }

.chart-card {
  padding: 10px;
  flex-shrink: 0;
}

.topo-detail-card {
  border-left: 2px solid rgba(0, 242, 255, 0.35);
}

.chart-card:nth-child(1) {
  animation: ambient-glow 5s ease-in-out infinite alternate;
}

.chart-card:nth-child(2) {
  animation: ambient-glow 5s ease-in-out 1.5s infinite alternate;  /* ★ 延迟 */
}

.chart-card:nth-child(3) {
  animation: ambient-glow 5s ease-in-out 3s infinite alternate;    /* ★ 延迟 */
}

@keyframes ambient-glow {
  from {
    border-color: rgba(0, 242, 255, 0.06);
    box-shadow: 0 0 8px rgba(0, 242, 255, 0.02) inset;
  }
  to {
    border-color: rgba(0, 242, 255, 0.18);
    box-shadow: 0 0 16px rgba(0, 242, 255, 0.08) inset;
  }
}

.echart-box {
  width: 100%;
  height: 150px;
  min-height: 150px;
}

.gauge-box {
  height: 150px;
  min-height: 150px;
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
  gap: 8px;
  padding: 6px 10px;                          /* ★ 增大内边距 */
  background: rgba(0, 0, 0, 0.2);             /* ★ 新增底色 */
  border-radius: 4px 4px 0 0;
  font-family: var(--font-mono);
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
  color: #64748b;
  letter-spacing: 1.5px;
  flex: 1;
  font-weight: 500;                           /* ★ 加粗 */
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

/* ── 合作模式恢复总览 ── */
.coop-dashboard {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.dash-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 8px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.15);
  font-family: var(--font-mono);
}

.dash-block {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.dash-block:last-child {
  border-bottom: none;
}

.subtle-row {
  background: rgba(255, 255, 255, 0.02);
}

.dash-label {
  font-size: 10px;
  color: var(--text-dim);
}

.dash-value {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
}

.val-green { color: #00ff88; text-shadow: 0 0 6px rgba(0,255,136,0.3); }
.val-yellow { color: #facc15; }
.val-red { color: #ff3b3b; text-shadow: 0 0 6px rgba(255,59,59,0.3); }

/* ── 事件时间线 ── */
.event-timeline {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
  max-height: 200px;
  overflow-y: auto;
}

.timeline-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  font-size: 10px;
  font-family: var(--font-mono);
  border-radius: 2px;
}

.failure-item { background: rgba(255, 59, 59, 0.06); }
.recovery-item { background: rgba(0, 255, 136, 0.04); }

.tl-time {
  color: var(--text-dim);
  min-width: 40px;
  text-align: right;
}

.tl-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.yellow-dot {
  background: #facc15;
  box-shadow: 0 0 8px #facc15, 0 0 16px #facc1560;
}

.tl-text {
  color: var(--text-secondary);
  flex: 1;
  white-space: normal;
  line-height: 1.45;
}

/* ── 关键节点列表 ── */
.key-nodes-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 8px;
}

.kn-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-left: 3px solid #00f2ff;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 0 2px 2px 0;
  font-family: var(--font-mono);
  font-size: 11px;
}

.kn-rank {
  color: var(--text-dim);
  min-width: 24px;
}

.kn-id {
  color: var(--text-primary);
  flex: 1;
}

.kn-score {
  font-weight: 700;
}
</style>

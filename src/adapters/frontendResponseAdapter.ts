import type {
  FrontendResponseData,
  SharedData,
  FrontendResponseMeta
} from '../types'
import type {
  CooperativeData,
  CooperativeDashboardSnapshot,
  CooperativeMetricsSample
} from '../types/cooperative'
import type {
  NonCooperativeData,
  KeyNodeCandidate,
  ObservedSignalEvent,
  InferredGraphNode
} from '../types/nonCooperative'

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, any>) }
    : {}
}

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? [...value] : []
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function extractTimeSec(raw: Record<string, any>, keys: string[]): number | null {
  for (const k of keys) {
    const v = raw[k]
    if (v === 0) return 0
    if (v !== undefined && v !== null && v !== '') {
      const num = Number(v)
      if (Number.isFinite(num)) return num
    }
  }
  return null
}

function normalizeMeta(meta: FrontendResponseData['meta'] | undefined): FrontendResponseMeta {
  const raw = asRecord(meta)
  return {
    taskId: String(raw.taskId ?? ''),
    operationMode: raw.operationMode === 'non_cooperative' ? 'non_cooperative' : 'cooperative',
    sceneType: String(raw.sceneType ?? 'urban'),
    difficulty: String(raw.difficulty ?? 'Moderate'),
    communicationMode: raw.communicationMode ? String(raw.communicationMode) : undefined,
    formation: String(raw.formation ?? 'v_formation')
  }
}

function normalizeShared(shared: FrontendResponseData['shared'] | undefined): SharedData {
  const raw = asRecord(shared)
  return {
    environment_summary: asRecord(raw.environment_summary),
    request_metadata: asRecord(raw.request_metadata),
    positions: asArray(raw.positions),
    transmissions: asArray(raw.transmissions),
    topology_links: asArray(raw.topology_links),
    topology_evolution: asArray(raw.topology_evolution),
    topology_detailed: asArray(raw.topology_detailed),
    resource_detailed: asArray(raw.resource_detailed).map((item) => {
      const row = asRecord(item)
      const interference = row.interference ?? row.interference_dBm
      return {
        ...row,
        interference: interference !== undefined && interference !== null
          ? asNumber(interference)
          : interference
      }
    }),
    qos: asArray(raw.qos),
    flow_summary: asArray(raw.flow_summary)
  }
}

function normalizeCooperative(cooperative: FrontendResponseData['cooperative'] | undefined): CooperativeData {
  const raw = asRecord(cooperative)
  const dashboardRaw = asRecord(raw.dashboard_snapshot)
  const failureTimelineRaw = raw.failure_timeline
  const recoveryTimelineRaw = raw.recovery_timeline
  const metricsRaw = raw.metrics_timeseries
  const dashboard: CooperativeDashboardSnapshot | undefined = Object.keys(dashboardRaw).length > 0
    ? {
        ...dashboardRaw,
        responseTimeSec: extractTimeSec(dashboardRaw, ['responseTimeSec', 'response_time_sec', 'responseTime']) as number,
        recoveryTimeSec: extractTimeSec(dashboardRaw, ['recoveryTimeSec', 'recovery_time_sec', 'recoveryTime']) as number,
        stabilizationTimeSec: extractTimeSec(dashboardRaw, ['stabilizationTimeSec', 'stabilization_time_sec', 'stabilizationTime']) as number,
        latestActionType: String(
          dashboardRaw.latestActionType
          ?? dashboardRaw.latestRecoveryAction
          ?? ''
        )
      } as CooperativeDashboardSnapshot
    : undefined

  return {
    mode_summary: Object.keys(asRecord(raw.mode_summary)).length > 0 ? asRecord(raw.mode_summary) as any : undefined,
    dashboard_snapshot: dashboard,
    failure_timeline: {
      events: Array.isArray(failureTimelineRaw)
        ? asArray(failureTimelineRaw)
        : asArray(raw.failure_timeline?.events ?? raw.failure_events)
    },
    recovery_timeline: {
      actions: Array.isArray(recoveryTimelineRaw)
        ? asArray(recoveryTimelineRaw)
        : asArray(raw.recovery_timeline?.actions ?? raw.recovery_actions)
    },
    metrics_timeseries: {
      samples: (Array.isArray(metricsRaw)
        ? asArray(metricsRaw)
        : asArray(raw.metrics_timeseries?.samples ?? raw.recovery_metrics)
      ).map(s => {
        const sr = asRecord(s)
        return {
          ...sr,
          responseTimeSec: extractTimeSec(sr, ['responseTimeSec', 'response_time_sec', 'responseTime']),
          recoveryTimeSec: extractTimeSec(sr, ['recoveryTimeSec', 'recovery_time_sec', 'recoveryTime']),
          stabilizationTimeSec: extractTimeSec(sr, ['stabilizationTimeSec', 'stabilization_time_sec', 'stabilizationTime'])
        } as unknown as CooperativeMetricsSample
      })
    },
    failure_events: asArray(raw.failure_events),
    recovery_actions: asArray(raw.recovery_actions),
    recovery_metrics: asArray(raw.recovery_metrics),
    decision_trace: asArray(raw.decision_trace)
  }
}

function normalizeKeyNodeCandidate(candidate: unknown, index: number): KeyNodeCandidate {
  const raw = asRecord(candidate)
  return {
    ...raw,
    nodeId: asNumber(raw.nodeId ?? raw.observedNodeId, index + 1),
    score: asNumber(raw.score ?? raw.keyNodeScore ?? raw.key_node_score, 0),
    rank: asNumber(raw.rank, index + 1),
    role: String(raw.role ?? raw.nodeRole ?? raw.node_type ?? 'unknown')
  }
}

function normalizeObservedSignalEvent(item: unknown): ObservedSignalEvent {
  const row = asRecord(item)
  return {
    ...row,
    time: asNumber(row.time ?? row.eventTime ?? row.txStartTime),
    nodeId: asNumber(row.nodeId ?? row.observedNodeId, 0),
    signalType: String(row.signalType ?? row.signal_type ?? row.eventType ?? 'unknown'),
    frequency: asNumber(row.frequency ?? row.centerFrequencyHz),
    power: asNumber(row.power ?? row.avgRxPowerDbm),
    duration: asNumber(row.duration ?? row.txDuration),
    confidence: asNumber(row.confidence ?? row.windowConfidence ?? 0)
  }
}

function normalizeInferredGraphNode(item: unknown): InferredGraphNode {
  const row = asRecord(item)
  return {
    ...row,
    nodeId: asNumber(row.nodeId ?? row.observedNodeId, 0),
    weight: asNumber(row.weight),
    degree: asNumber(row.degree),
    centrality: asNumber(row.centrality)
  }
}

function normalizeNonCooperative(nonCooperative: FrontendResponseData['non_cooperative'] | undefined): NonCooperativeData {
  const raw = asRecord(nonCooperative)
  const observation = asRecord(raw.observation_inference)
  const attack = asRecord(raw.attack)

  return {
    observation_inference: {
      observed_signal_events: asArray(observation.observed_signal_events).map(normalizeObservedSignalEvent),
      observed_comm_windows: asArray(observation.observed_comm_windows),
      observed_link_evidence: asArray(observation.observed_link_evidence).map((item) => {
        const row = asRecord(item)
        return {
          ...row,
          srcNode: asNumber(row.srcNode ?? row.srcObservedNodeId, 0),
          dstNode: asNumber(row.dstNode ?? row.dstObservedNodeId, 0),
          confidence: asNumber(row.confidence ?? row.edgeObservationConfidence),
          observedTime: asNumber(row.observedTime ?? row.windowStart),
          evidenceType: String(row.evidenceType ?? row.dominantDirection ?? 'evidence')
        }
      }),
      inferred_topology_edges: asArray(observation.inferred_topology_edges).map((item) => {
        const row = asRecord(item)
        return {
          ...row,
          srcNode: asNumber(row.srcNode ?? row.srcObservedNodeId, 0),
          dstNode: asNumber(row.dstNode ?? row.dstObservedNodeId, 0),
          probability: asNumber(row.probability ?? row.edgeProbability),
          confidence: asNumber(row.confidence ?? row.edgeConfidence),
          inferenceMethod: String(row.inferenceMethod ?? 'unknown')
        }
      }),
      inferred_graph_nodes: asArray(observation.inferred_graph_nodes).map(normalizeInferredGraphNode),
      key_node_candidates: asArray(observation.key_node_candidates).map(normalizeKeyNodeCandidate)
    },
    attack: {
      recommendations: asArray(attack.recommendations),
      plan: Object.keys(asRecord(attack.plan)).length > 0 ? asRecord(attack.plan) as any : undefined,
      events: asArray(attack.events),
      target_binding: asArray(attack.target_binding),
      effect_metrics: asArray(attack.effect_metrics),
      summary: Object.keys(asRecord(attack.summary)).length > 0 ? asRecord(attack.summary) as any : undefined
    }
  }
}

export function normalizeFrontendResponse(data: FrontendResponseData): FrontendResponseData {
  const raw = asRecord(data)
  return {
    meta: normalizeMeta(raw.meta as FrontendResponseData['meta']),
    shared: normalizeShared(raw.shared as FrontendResponseData['shared']),
    cooperative: normalizeCooperative(raw.cooperative as FrontendResponseData['cooperative']),
    non_cooperative: normalizeNonCooperative(raw.non_cooperative as FrontendResponseData['non_cooperative']),
    manifest: asRecord(raw.manifest)
  }
}

const FIELD_LABELS: Array<[RegExp, string]> = [
  [/^shared\.(positions|qos|topology_evolution|topology_links|transmissions|resource_detailed)$/, '基础回放数据'],
  [/^shared\.environment_summary$/, '环境摘要'],
  [/^cooperative\.mode_summary$/, '合作模式任务摘要'],
  [/^cooperative\.dashboard_snapshot$/, '合作模式恢复总览'],
  [/^cooperative\.failure_timeline\.events$/, '合作模式故障时间线'],
  [/^cooperative\.recovery_timeline\.actions$/, '合作模式恢复动作'],
  [/^cooperative\.metrics_timeseries\.samples$/, '合作模式指标曲线'],
  [/^non_cooperative\.observation_inference\.observed_signal_events$/, '观测事件'],
  [/^non_cooperative\.observation_inference\.observed_comm_windows$/, '观测窗口'],
  [/^non_cooperative\.observation_inference\.observed_link_evidence$/, '链路证据'],
  [/^non_cooperative\.observation_inference\.inferred_topology_edges$/, '拓扑推断结果'],
  [/^non_cooperative\.observation_inference\.inferred_graph_nodes$/, '推断节点结果'],
  [/^non_cooperative\.observation_inference\.key_node_candidates$/, '关键节点识别结果'],
  [/^non_cooperative\.attack\.recommendations$/, '打击建议'],
  [/^non_cooperative\.attack\.plan$/, '打击计划'],
  [/^non_cooperative\.attack\.events$/, '打击事件'],
  [/^non_cooperative\.attack\.target_binding$/, '目标绑定结果'],
  [/^non_cooperative\.attack\.effect_metrics$/, '打击效果评估'],
  [/^non_cooperative\.attack\.summary$/, '打击闭环摘要']
]

function mapFieldLabel(field: string): string {
  const matched = FIELD_LABELS.find(([pattern]) => pattern.test(field))
  return matched ? matched[1] : '结果模块'
}

export function formatFrontendDisplayError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error || '')

  if (!rawMessage) {
    return '任务执行失败，请检查后端服务是否在线。'
  }

  if (rawMessage.includes('后端返回的数据不完整')) {
    const fields = rawMessage
      .split('\n')
      .map((line) => line.replace(/^-+\s*/, '').trim())
      .filter((line) => line && line !== '后端返回的数据不完整，缺少以下字段：')

    const labels = Array.from(new Set(fields.map(mapFieldLabel)))
    return labels.length > 0
      ? `任务已执行，但后端尚未生成完整的展示结果：${labels.join('、')}。`
      : '任务已执行，但后端尚未生成完整的展示结果。'
  }

  if (
    rawMessage.includes('无法解析出任何回放帧')
    || rawMessage.includes('shared.positions')
    || rawMessage.includes('shared.qos')
    || rawMessage.includes('shared.topology_evolution')
  ) {
    return '任务已完成，但基础回放结果未成功生成，当前无法播放无人机时序画面。'
  }

  if (rawMessage.startsWith('Server simulation failed:')) {
    return `后端推演执行失败：${rawMessage.replace('Server simulation failed:', '').trim()}`
  }

  if (rawMessage.startsWith('Failed to start simulation:')) {
    return '提交任务失败，请检查后端服务和接口地址是否可用。'
  }

  if (rawMessage.startsWith('Failed to poll')) {
    return '任务已提交，但拉取后端结果失败，请检查结果接口是否可访问。'
  }

  return rawMessage
}

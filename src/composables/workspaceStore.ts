/**
 * 工作区数据仓库
 * 统一管理 runMeta + workspaceData (shared / cooperative / nonCooperative)
 */
import { ref, computed, reactive } from 'vue'
import type {
  RunMeta,
  WorkspaceData,
  SharedData,
  FrontendResponseData,
  FrameData,
  UAVNode
} from '../types'
import type { CooperativeData } from '../types/cooperative'
import type { NonCooperativeData } from '../types/nonCooperative'
import { normalizeFrontendResponse } from '../adapters/frontendResponseAdapter'

// ── 空状态工厂 ──
function emptyShared(): SharedData {
  return {
    environment_summary: {},
    request_metadata: {},
    positions: [],
    transmissions: [],
    topology_links: [],
    topology_evolution: [],
    topology_detailed: [],
    resource_detailed: [],
    qos: [],
    flow_summary: []
  }
}

function emptyCooperative(): CooperativeData {
  return {}
}

function emptyNonCooperative(): NonCooperativeData {
  return {
    observation_inference: {},
    attack: {}
  }
}

// ── 全局唯一状态 ──
const runMeta = reactive<RunMeta>({
  taskId: '',
  operationMode: 'cooperative',
  sceneType: 'urban',
  difficulty: 'Moderate',
  formation: 'v_formation',
  communicationMode: 'hybrid'
})

const workspaceData = reactive<WorkspaceData>({
  shared: emptyShared(),
  cooperative: emptyCooperative(),
  nonCooperative: emptyNonCooperative()
})

const taskStatus = ref<'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILED'>('IDLE')

export function useWorkspaceStore() {

  const isCooperative = computed(() => runMeta.operationMode === 'cooperative')
  const isNonCooperative = computed(() => runMeta.operationMode === 'non_cooperative')

  /** 从 /api/results/<task_id>/frontend 响应填充 */
  function loadFromFrontendResponse(data: FrontendResponseData) {
    const normalized = normalizeFrontendResponse(data)

    // meta
    if (normalized.meta) {
      runMeta.taskId = normalized.meta.taskId
      runMeta.operationMode = normalized.meta.operationMode
      runMeta.sceneType = normalized.meta.sceneType
      runMeta.difficulty = normalized.meta.difficulty
      runMeta.formation = normalized.meta.formation
      runMeta.communicationMode = normalized.meta.communicationMode
    }

    Object.assign(workspaceData.shared, emptyShared(), normalized.shared || {})
    Object.assign(workspaceData.cooperative, emptyCooperative(), normalized.cooperative || {})
    Object.assign(workspaceData.nonCooperative, emptyNonCooperative(), normalized.non_cooperative || {})
  }

  /** 清空所有数据 */
  function reset() {
    runMeta.taskId = ''
    runMeta.operationMode = 'cooperative'
    runMeta.sceneType = 'urban'
    runMeta.difficulty = 'Moderate'
    runMeta.formation = 'v_formation'
    runMeta.communicationMode = 'hybrid'

    Object.assign(workspaceData.shared, emptyShared())
    Object.assign(workspaceData.cooperative, emptyCooperative())
    Object.assign(workspaceData.nonCooperative, emptyNonCooperative())

    taskStatus.value = 'IDLE'
  }

  function setTaskStatus(s: typeof taskStatus.value) {
    taskStatus.value = s
  }

  return {
    runMeta,
    workspaceData,
    taskStatus,
    isCooperative,
    isNonCooperative,
    loadFromFrontendResponse,
    reset,
    setTaskStatus
  }
}

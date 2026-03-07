/**
 * 场景状态管理 — ScenarioEditor 和 CenterSandbox 共享
 */
import { reactive, ref } from 'vue'
import type { SceneConfig } from '../types'
import { defaultScene } from '../data/mockData'

// 当前活跃场景（响应式，修改后 3D 沙盘自动刷新）
export const activeScene = reactive<SceneConfig>({
    buildings: [...defaultScene.buildings],
    interferenceZones: [...defaultScene.interferenceZones],
    gridSize: defaultScene.gridSize
})

// 起点和终点坐标
export const missionWaypoints = reactive({
    start: '0,0,30',
    target: '500,500,30'
})

// 交互状态 (如：从 3D 沙盘点选坐标)
export const interactionState = reactive({
    mode: 'none' as 'none' | 'setStart' | 'setTarget'
})

// 场景版本号 — 每次修改递增，触发 3D 重建
export const sceneVersion = ref(0)

// 仿真算法策略 (static | dynamic) — 影响 QoS 的恢复效果
export const simulationStrategy = ref<'static' | 'dynamic'>('dynamic')

export function applyScene(config: SceneConfig) {
    activeScene.buildings = [...config.buildings]
    activeScene.interferenceZones = [...config.interferenceZones]
    activeScene.gridSize = config.gridSize
    sceneVersion.value++
}

export function resetScene() {
    activeScene.buildings = [...defaultScene.buildings]
    activeScene.interferenceZones = [...defaultScene.interferenceZones]
    activeScene.gridSize = defaultScene.gridSize
    sceneVersion.value++
}

/** 清空场景 — 移除所有建筑和干扰圈 */
export function clearScene() {
    activeScene.buildings = []
    activeScene.interferenceZones = []
    sceneVersion.value++
}

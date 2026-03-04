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

// 场景版本号 — 每次修改递增，触发 3D 重建
export const sceneVersion = ref(0)

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

<script setup lang="ts">
import { onMounted, provide, ref } from 'vue'
import TopBar from './components/TopBar.vue'
import LeftPanel from './components/LeftPanel.vue'
import RightPanel from './components/RightPanel.vue'
import CenterSandbox from './components/CenterSandbox.vue'
import PlaybackBar from './components/PlaybackBar.vue'
import UAVDetail from './components/UAVDetail.vue'
import AlertOverlay from './components/AlertOverlay.vue'
import ScenarioEditor from './components/ScenarioEditor.vue'
import ResearchLab from './components/ResearchLab.vue'
import { usePlaybackEngine } from './composables/usePlaybackEngine'
import { generateMockFrames } from './data/mockData'
import { loadCSVFrames } from './services/csvParser'
import type { UAVNode } from './types'

const engine = usePlaybackEngine()
const selectedUAV = ref<UAVNode | null>(null)
const showAlert = ref(false)
const showEditor = ref(false)
const showLab = ref(false)
const dataMode = ref<'mock' | 'csv'>('mock')
const loading = ref(true)

provide('engine', engine)
provide('selectedUAV', selectedUAV)

function onSelectUAV(uav: UAVNode | null) {
  selectedUAV.value = uav
}

onMounted(async () => {
  // 通过 URL 参数切换数据源: ?mode=csv
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode')

  try {
    if (mode === 'csv') {
      dataMode.value = 'csv'
      const csvPath = params.get('path') || '/data'
      console.log(`[WingNet] 加载 CSV 数据: ${csvPath}`)
      const frames = await loadCSVFrames(csvPath)
      engine.loadFrames(frames)
      console.log(`[WingNet] CSV 加载完毕, 共 ${frames.length} 帧`)
    } else {
      dataMode.value = 'mock'
      const frames = generateMockFrames()
      engine.loadFrames(frames)
      console.log(`[WingNet] Mock 数据加载完毕, 共 ${frames.length} 帧`)
    }
    engine.play()
  } catch (e) {
    console.error('[WingNet] 数据加载失败，回退到 Mock 模式', e)
    dataMode.value = 'mock'
    const frames = generateMockFrames()
    engine.loadFrames(frames)
    engine.play()
  }
  loading.value = false
})
</script>

<template>
  <div class="app-root">
    <!-- 全局告警覆层 -->
    <AlertOverlay :active="showAlert" />

    <!-- 顶栏 -->
    <TopBar />

    <!-- 三栏主体 -->
    <div class="main-body">
      <LeftPanel class="panel-left" />
      <div class="panel-center">
        <CenterSandbox @select-uav="onSelectUAV" />
        <!-- 浮动工具按钮 -->
        <div class="floating-tools">
          <button class="float-btn" @click="showEditor = true" title="场景编辑器">
            🏗
          </button>
          <button class="float-btn" @click="showLab = true" title="科研实验室">
            🔬
          </button>
        </div>
      </div>
      <RightPanel class="panel-right" />
    </div>

    <!-- 底部播放控制 -->
    <PlaybackBar />

    <!-- 无人机详情弹窗 -->
    <UAVDetail
      v-if="selectedUAV"
      :uav="selectedUAV"
      @close="selectedUAV = null"
    />

    <!-- 场景编辑器 -->
    <ScenarioEditor v-if="showEditor" @close="showEditor = false" />

    <!-- 科研实验室 -->
    <ResearchLab v-if="showLab" @close="showLab = false" />
  </div>
</template>

<style scoped>
.app-root {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
  overflow: hidden;
  position: relative;
}

.main-body {
  flex: 1;
  display: flex;
  gap: 0;
  overflow: hidden;
  padding: 0 8px 8px;
}

.panel-left {
  width: 300px;
  min-width: 260px;
  flex-shrink: 0;
}

.panel-center {
  flex: 1;
  position: relative;
  margin: 0 8px;
}

.panel-right {
  width: 320px;
  min-width: 280px;
  flex-shrink: 0;
}

.floating-tools {
  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 50;
}

.float-btn {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  color: var(--cyan);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  box-shadow: var(--glass-shadow);
}

.float-btn:hover {
  background: var(--cyan-dim);
  border-color: var(--cyan);
  box-shadow: var(--cyan-glow);
  transform: scale(1.1);
}
</style>

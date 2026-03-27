<script setup lang="ts">
import { inject, computed } from 'vue'
import { useAppMode, type SceneType } from '../composables/useAppMode'
import { useWorkspaceStore } from '../composables/workspaceStore'

const { currentAppMode, currentScene, setMode } = useAppMode()
const { runMeta, taskStatus, workspaceData } = useWorkspaceStore()

function exitToEntry() {
  setMode('entry')
}

const sceneNames: Record<SceneType, string> = {
  city: '城市高楼',
  forest: '森林遮挡',
  open: '湖泊',
  wild: '空旷'
}
const backendSceneNames: Record<string, string> = {
  urban: '城市高楼',
  forest: '森林遮挡',
  lake: '湖泊水域',
  'open-field': '开阔野地'
}
const sceneName = computed(() => {
  if (runMeta.sceneType) {
    return backendSceneNames[runMeta.sceneType] || runMeta.sceneType
  }
  return sceneNames[currentScene.value] || '未知环境'
})
const modeName = computed(() => currentAppMode.value === 'cooperative' ? '合作场景推演' : '非合作侦察对抗')

const engine = inject<any>('engine')
const frame = computed(() => engine?.currentFrame?.value)
const simTime = computed(() => Number(frame.value?.tick ?? 0))
const coopDashboard = computed(() => workspaceData.cooperative?.dashboard_snapshot)
const ncAttackPlan = computed(() => workspaceData.nonCooperative?.attack?.plan)
</script>

<template>
  <header class="top-bar glass-panel">
    <!-- 扫描线效果 -->
    <div class="scan-line-track">
      <div class="scan-line-beam"></div>
    </div>

    <div class="top-left">
      <div class="logo">
        <div class="logo-icon">
          <!-- ★ 改用呼吸代替旋转，更沉稳大气 -->
          <svg width="32" height="32" viewBox="0 0 28 28" class="logo-svg">
            <polygon points="14,2 26,14 14,26 2,14" fill="none" stroke="currentColor" stroke-width="1.5" />
            <polygon points="14,6 22,14 14,22 6,14" fill="none" stroke="currentColor" stroke-width="0.8" opacity="0.5" />
            <circle cx="14" cy="14" r="2.5" fill="currentColor" class="logo-core"/>
          </svg>
        </div>
        <div class="logo-text">
          <span class="logo-main">天枢·翼阵</span>
          <span class="logo-sub">Celestial Pivot</span>
        </div>
      </div>
      
      <button class="back-btn" @click="exitToEntry" title="返回模式选择">
        ◀ 返回控制塔
      </button>
    </div>

    <div class="top-center">
      <div class="status-chips">
        <!-- 当前环境与模式指示 -->
        <div class="chip scene-chip">
          <span class="dot cyan-dot"></span>
          <span class="chip-label">环境</span>
          <span class="chip-value">{{ sceneName }}</span>
        </div>
        <div class="chip mode-chip" :class="{'danger-mode': currentAppMode === 'non_cooperative'}">
          <span class="dot" :class="currentAppMode === 'non_cooperative' ? 'red-dot' : 'green-dot'"></span>
          <span class="chip-label">模式</span>
          <span class="chip-value">{{ modeName }}</span>
        </div>
        <div v-if="currentAppMode === 'cooperative' && coopDashboard?.phase" class="chip">
          <span class="dot cyan-dot"></span>
          <span class="chip-label">阶段</span>
          <span class="chip-value">{{ coopDashboard.phase }}</span>
        </div>
        <div v-if="currentAppMode === 'cooperative' && coopDashboard?.failureTargetId != null" class="chip">
          <span class="dot" :class="coopDashboard?.failureActive ? 'red-dot' : 'cyan-dot'"></span>
          <span class="chip-label">故障目标</span>
          <span class="chip-value">Node {{ coopDashboard.failureTargetId }}</span>
        </div>
        <div v-if="currentAppMode === 'cooperative' && coopDashboard?.recoveryStatus" class="chip">
          <span class="dot" :class="['stable', 'completed', 'recovered'].includes(coopDashboard.recoveryStatus) ? 'green-dot' : coopDashboard.recoveryStatus === 'active' ? 'dot-yellow' : 'red-dot'"></span>
          <span class="chip-label">恢复</span>
          <span class="chip-value">{{ coopDashboard.recoveryStatus }}</span>
        </div>
        <div v-if="currentAppMode === 'non_cooperative' && ncAttackPlan?.attackType" class="chip">
          <span class="dot red-dot"></span>
          <span class="chip-label">打击类型</span>
          <span class="chip-value">{{ ncAttackPlan.attackType }}</span>
        </div>
        <div v-if="currentAppMode === 'non_cooperative' && ncAttackPlan?.targetBindingStatus" class="chip">
          <span class="dot" :class="['confirmed', 'binding_success', 'stable'].includes(ncAttackPlan.targetBindingStatus) ? 'green-dot' : 'yellow-dot'"></span>
          <span class="chip-label">绑定</span>
          <span class="chip-value">{{ ncAttackPlan.targetBindingStatus }}</span>
        </div>
        <!-- 任务 ID -->
        <div v-if="runMeta.taskId" class="chip">
          <span class="dot" :class="taskStatus === 'RUNNING' ? 'cyan-dot pulse-dot' : taskStatus === 'SUCCESS' ? 'green-dot' : taskStatus === 'FAILED' ? 'red-dot' : 'cyan-dot'"></span>
          <span class="chip-label">任务</span>
          <span class="chip-value">{{ runMeta.taskId.substring(0, 8) }}</span>
        </div>
      </div>
    </div>

    <div class="top-right">
      <div class="time-block">
        <div class="sys-time">
          <span class="time-label">推演时间</span>
          <span class="time-value">{{ simTime.toFixed(1) }}s</span>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;           /* ★ 微增高度，呼吸感更好 */
  padding: 0 24px;
  margin: 8px 8px 0;
  position: relative;
  z-index: 100;
  overflow: hidden;
}

.top-bar::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 10%;
  right: 10%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--cyan), transparent);
}

/* ── 扫描线优化：更柔和 ── */
.scan-line-track {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.scan-line-beam {
  position: absolute;
  top: 0;
  left: 0;
  width: 120px;          /* ★ 更宽更柔和 */
  height: 100%;
  background: linear-gradient(90deg,
    transparent,
    rgba(0, 242, 255, 0.03),
    rgba(0, 242, 255, 0.05),
    rgba(0, 242, 255, 0.03),
    transparent);
  animation: scan-line-h 6s linear infinite;  /* ★ 减速 */
}

@keyframes scan-line-h {
  from { transform: translateX(-120px); }
  to   { transform: translateX(calc(100vw + 120px)); }
}

@keyframes scan-line-h {
  from { transform: translateX(-120px); }
  to   { transform: translateX(calc(100vw + 120px)); }
}

.top-left { display: flex; align-items: center; gap: 20px; }
.top-center {
  flex: 1;
  min-width: 0;
  display: flex;
  justify-content: center;
  padding: 0 16px;
}

.top-right {
  flex-shrink: 0;
}

.back-btn {
  background: rgba(0, 242, 255, 0.1);
  border: 1px solid rgba(0, 242, 255, 0.3);
  color: var(--cyan);
  padding: 6px 14px;
  border-radius: 16px;
  font-size: 13px;
  font-family: var(--font-body);
  cursor: pointer;
  transition: all 0.3s ease;
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  gap: 4px;
}
.back-btn:hover {
  background: var(--cyan-dim);
  border-color: var(--cyan);
  transform: translateX(-2px);
  box-shadow: 0 0 10px rgba(0, 242, 255, 0.2);
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-icon {
  color: var(--cyan);
  filter: drop-shadow(0 0 8px rgba(0, 242, 255, 0.5));
}

/* ★ 去掉 spin，只保留呼吸——更专业 */
.logo-svg {
  animation: logo-breathe 3s ease-in-out infinite;
}

.logo-core {
  animation: core-pulse 2s ease-in-out infinite;
}

@keyframes logo-breathe {
  0%, 100% { filter: drop-shadow(0 0 4px rgba(0, 242, 255, 0.4)); }
  50% { filter: drop-shadow(0 0 14px rgba(0, 242, 255, 0.9)); }
}

@keyframes core-pulse {
  0%, 100% { r: 2.5; opacity: 0.8; }
  50% { r: 3; opacity: 1; }
}

.logo-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.logo-main {
  font-family: var(--font-body);
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 5px;
}

.logo-sub {
  font-family: var(--font-display);
  font-size: 9px;
  color: var(--cyan);
  letter-spacing: 3px;
  opacity: 0.8;
}

/* ── 状态芯片增强 ── */
.status-chips {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
  overflow: hidden;
}

.chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 20px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.06);
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--text-secondary);
  transition: all var(--transition-normal);
  cursor: default;
}

.chip:hover {
  background: rgba(0, 242, 255, 0.05);
  border-color: rgba(0, 242, 255, 0.15);
}

.mode-chip.danger-mode {
  border-color: rgba(255, 59, 59, 0.3);
  background: rgba(255, 59, 59, 0.08);
  color: #ff3c3c;
}
.mode-chip.danger-mode .chip-value {
  color: #ff3c3c;
}

.chip-label {
  color: var(--text-dim);
  font-size: 10px;
}

.chip-value {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--text-primary);
  font-size: 12px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

.green-dot { background: var(--green); box-shadow: 0 0 6px var(--green); }
.cyan-dot  { background: var(--cyan); box-shadow: 0 0 6px var(--cyan); }
.red-dot   { background: var(--red); box-shadow: 0 0 6px var(--red); }

.pulse-dot {
  animation: dot-blink 2s infinite;
}

@keyframes dot-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* ── 时间区块优化 ── */
.time-block {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sys-time {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.time-label {
  font-family: var(--font-display);
  font-size: 8px;
  color: var(--text-dim);
  letter-spacing: 2px;
}

.time-value {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  color: #ffffff; /* 核心变白，发光留给 shadow */
  text-shadow: 0 0 8px rgba(0, 242, 255, 0.8), 0 0 16px rgba(0, 242, 255, 0.4); /* 收紧内层发光，扩大外层柔光 */
  line-height: 1;
}
</style>

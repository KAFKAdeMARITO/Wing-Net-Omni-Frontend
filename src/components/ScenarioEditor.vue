<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import type { BuildingBlock, InterferenceZone, SceneConfig } from '../types'
import { applyScene, clearScene, resetScene } from '../composables/useScene'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const GRID = 600
const CANVAS_SIZE = 500

const mode = ref<'building' | 'interference'>('building')
const buildingHeight = ref(80)
const zoneStrength = ref(0.8)

const buildings = reactive<BuildingBlock[]>([])
const zones = reactive<InterferenceZone[]>([])

const isDrawing = ref(false)
const drawStart = ref({ x: 0, y: 0 })
const drawCurrent = ref({ x: 0, y: 0 })

function canvasToGrid(cx: number, cy: number) {
  const scale = GRID / CANVAS_SIZE
  return { x: cx * scale, y: cy * scale }
}
function gridToCanvas(gx: number, gy: number) {
  const scale = CANVAS_SIZE / GRID
  return { x: gx * scale, y: gy * scale }
}
function getCanvasPos(e: MouseEvent) {
  const rect = canvasRef.value!.getBoundingClientRect()
  return {
    x: (e.clientX - rect.left) * (CANVAS_SIZE / rect.width),
    y: (e.clientY - rect.top) * (CANVAS_SIZE / rect.height)
  }
}

function handleMouseDown(e: MouseEvent) {
  isDrawing.value = true
  const pos = getCanvasPos(e)
  drawStart.value = pos
  drawCurrent.value = pos
}
function handleMouseMove(e: MouseEvent) {
  if (!isDrawing.value) return
  drawCurrent.value = getCanvasPos(e)
  redraw()
}
function handleMouseUp(e: MouseEvent) {
  if (!isDrawing.value) return
  isDrawing.value = false
  const endPos = getCanvasPos(e)
  const start = canvasToGrid(drawStart.value.x, drawStart.value.y)
  const end = canvasToGrid(endPos.x, endPos.y)

  if (mode.value === 'building') {
    const w = Math.abs(end.x - start.x), d = Math.abs(end.y - start.y)
    if (w > 10 && d > 10) {
      buildings.push({
        x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
        width: w, depth: d, height: buildingHeight.value
      })
    }
  } else {
    const dx = endPos.x - drawStart.value.x, dy = endPos.y - drawStart.value.y
    const r = Math.sqrt(dx * dx + dy * dy) * (GRID / CANVAS_SIZE)
    if (r > 10) {
      zones.push({ x: start.x, y: start.y, radius: r, strength: zoneStrength.value })
    }
  }
  redraw()
}
function handleMouseLeave() {
  if (isDrawing.value) { isDrawing.value = false; redraw() }
}

function redraw() {
  if (!canvasRef.value) return
  const ctx = canvasRef.value.getContext('2d')!
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

  // Background
  ctx.fillStyle = '#0a0e27'
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

  // Grid
  ctx.strokeStyle = 'rgba(0, 242, 255, 0.06)'
  ctx.lineWidth = 1
  const step = CANVAS_SIZE / 12
  for (let i = 0; i <= 12; i++) {
    ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, CANVAS_SIZE); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(CANVAS_SIZE, i * step); ctx.stroke()
  }

  // Existing buildings — with 2.5D isometric effect
  for (const b of buildings) {
    drawBuilding2_5D(ctx, b)
  }

  // Existing zones
  for (const z of zones) {
    drawZone(ctx, z)
  }

  // Live preview
  if (isDrawing.value) {
    const sx = drawStart.value.x, sy = drawStart.value.y
    const cx = drawCurrent.value.x, cy = drawCurrent.value.y

    if (mode.value === 'building') {
      const rx = Math.min(sx, cx), ry = Math.min(sy, cy)
      const rw = Math.abs(cx - sx), rh = Math.abs(cy - sy)
      const hPx = (buildingHeight.value / 150) * 25 // Scale height to pixel offset

      // 2.5D preview: top face
      ctx.fillStyle = 'rgba(0, 242, 255, 0.12)'
      ctx.beginPath()
      ctx.moveTo(rx, ry - hPx); ctx.lineTo(rx + rw, ry - hPx)
      ctx.lineTo(rx + rw, ry); ctx.lineTo(rx, ry)
      ctx.closePath(); ctx.fill()

      // Front face
      ctx.fillStyle = 'rgba(0, 242, 255, 0.06)'
      ctx.fillRect(rx, ry, rw, rh)

      // Dashed border
      ctx.strokeStyle = 'rgba(0, 242, 255, 0.7)'
      ctx.lineWidth = 2; ctx.setLineDash([6, 4])
      ctx.strokeRect(rx, ry, rw, rh)
      // Top face edges
      ctx.beginPath()
      ctx.moveTo(rx, ry); ctx.lineTo(rx, ry - hPx)
      ctx.moveTo(rx + rw, ry); ctx.lineTo(rx + rw, ry - hPx)
      ctx.moveTo(rx, ry - hPx); ctx.lineTo(rx + rw, ry - hPx)
      ctx.stroke()
      ctx.setLineDash([])

      // Labels
      const gStart = canvasToGrid(rx, ry), gEnd = canvasToGrid(rx + rw, ry + rh)
      const wm = Math.round(Math.abs(gEnd.x - gStart.x)), hm = Math.round(Math.abs(gEnd.y - gStart.y))
      ctx.fillStyle = 'rgba(0, 242, 255, 0.9)'
      ctx.font = 'bold 11px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(`${wm}×${hm}m H:${buildingHeight.value}m`, rx + rw / 2, ry + rh / 2 + 4)
      ctx.textAlign = 'start'

      // Corners
      ctx.fillStyle = '#00f2ff'
      const cs = 4
      ctx.fillRect(rx - cs/2, ry - cs/2, cs, cs)
      ctx.fillRect(rx + rw - cs/2, ry - cs/2, cs, cs)
      ctx.fillRect(rx - cs/2, ry + rh - cs/2, cs, cs)
      ctx.fillRect(rx + rw - cs/2, ry + rh - cs/2, cs, cs)

    } else {
      const dx = cx - sx, dy = cy - sy, r = Math.sqrt(dx * dx + dy * dy)
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
      grad.addColorStop(0, `rgba(255, 59, 59, ${zoneStrength.value * 0.2})`)
      grad.addColorStop(0.7, `rgba(255, 59, 59, ${zoneStrength.value * 0.08})`)
      grad.addColorStop(1, 'transparent')
      ctx.fillStyle = grad
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill()

      ctx.strokeStyle = 'rgba(255, 59, 59, 0.7)'
      ctx.lineWidth = 2; ctx.setLineDash([6, 4])
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke()
      ctx.setLineDash([])

      // Radius line
      ctx.strokeStyle = 'rgba(255, 59, 59, 0.4)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3])
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(cx, cy); ctx.stroke(); ctx.setLineDash([])

      ctx.fillStyle = '#ff3b3b'
      ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI * 2); ctx.fill()

      const rGrid = Math.round(r * (GRID / CANVAS_SIZE))
      ctx.fillStyle = 'rgba(255, 59, 59, 0.9)'
      ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center'
      ctx.fillText(`r=${rGrid}m  S=${(zoneStrength.value * 100).toFixed(0)}%`, sx, sy - r - 8 > 15 ? sy - r - 8 : sy + r + 16)
      ctx.textAlign = 'start'
    }
  }
}

function drawBuilding2_5D(ctx: CanvasRenderingContext2D, b: BuildingBlock) {
  const tl = gridToCanvas(b.x, b.y)
  const br = gridToCanvas(b.x + b.width, b.y + b.depth)
  const bw = br.x - tl.x, bh = br.y - tl.y
  const hPx = (b.height / 150) * 25 // Isometric height offset

  // Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
  ctx.fillRect(tl.x + 3, tl.y + 3, bw, bh)

  // Front face
  const gradF = ctx.createLinearGradient(tl.x, tl.y, tl.x, tl.y + bh)
  gradF.addColorStop(0, 'rgba(25, 40, 80, 0.9)')
  gradF.addColorStop(1, 'rgba(12, 20, 50, 0.95)')
  ctx.fillStyle = gradF
  ctx.fillRect(tl.x, tl.y, bw, bh)

  // Top face (2.5D)
  ctx.fillStyle = 'rgba(40, 60, 110, 0.7)'
  ctx.beginPath()
  ctx.moveTo(tl.x, tl.y); ctx.lineTo(tl.x + 5, tl.y - hPx)
  ctx.lineTo(tl.x + bw + 5, tl.y - hPx); ctx.lineTo(tl.x + bw, tl.y)
  ctx.closePath(); ctx.fill()

  // Right face (2.5D)
  ctx.fillStyle = 'rgba(20, 30, 65, 0.8)'
  ctx.beginPath()
  ctx.moveTo(tl.x + bw, tl.y); ctx.lineTo(tl.x + bw + 5, tl.y - hPx)
  ctx.lineTo(tl.x + bw + 5, tl.y + bh - hPx); ctx.lineTo(tl.x + bw, tl.y + bh)
  ctx.closePath(); ctx.fill()

  // Edges
  ctx.strokeStyle = 'rgba(0, 242, 255, 0.25)'; ctx.lineWidth = 1
  ctx.strokeRect(tl.x, tl.y, bw, bh)
  ctx.beginPath()
  ctx.moveTo(tl.x, tl.y); ctx.lineTo(tl.x + 5, tl.y - hPx)
  ctx.lineTo(tl.x + bw + 5, tl.y - hPx); ctx.lineTo(tl.x + bw, tl.y)
  ctx.moveTo(tl.x + bw + 5, tl.y - hPx); ctx.lineTo(tl.x + bw + 5, tl.y + bh - hPx)
  ctx.lineTo(tl.x + bw, tl.y + bh)
  ctx.stroke()

  // Windows
  ctx.fillStyle = 'rgba(0, 242, 255, 0.1)'
  for (let wy = tl.y + 4; wy < tl.y + bh - 4; wy += 6)
    for (let wx = tl.x + 4; wx < tl.x + bw - 4; wx += 6)
      ctx.fillRect(wx, wy, 2.5, 2.5)

  // Height label
  ctx.fillStyle = 'rgba(0, 242, 255, 0.6)'
  ctx.font = '10px monospace'
  ctx.fillText(`${Math.round(b.height)}m`, tl.x + 4, tl.y + 14)
}

function drawZone(ctx: CanvasRenderingContext2D, z: InterferenceZone) {
  const c = gridToCanvas(z.x, z.y)
  const r = z.radius * (CANVAS_SIZE / GRID)
  const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r)
  grad.addColorStop(0, `rgba(255, 59, 59, ${z.strength * 0.15})`)
  grad.addColorStop(0.7, `rgba(255, 59, 59, ${z.strength * 0.05})`)
  grad.addColorStop(1, 'transparent')
  ctx.fillStyle = grad
  ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill()

  ctx.strokeStyle = `rgba(255, 59, 59, ${z.strength * 0.6})`
  ctx.lineWidth = 1.5; ctx.setLineDash([4, 4])
  ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke()
  ctx.setLineDash([])

  ctx.fillStyle = 'rgba(255, 59, 59, 0.7)'
  ctx.font = '10px monospace'; ctx.textAlign = 'center'
  ctx.fillText(`⚡ ${Math.round(z.strength * 100)}%`, c.x, c.y + 4)
  ctx.textAlign = 'start'
}

function clearAll() { buildings.length = 0; zones.length = 0; redraw() }

function applyToSandbox() {
  const config: SceneConfig = {
    buildings: [...buildings],
    interferenceZones: [...zones],
    gridSize: GRID
  }
  applyScene(config)
}

function exportScene() {
  const config: SceneConfig = {
    buildings: [...buildings],
    interferenceZones: [...zones],
    gridSize: GRID
  }
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'scene.json'; a.click()
  URL.revokeObjectURL(url)
}

function applyAndClose() {
  applyToSandbox()
  emit('close')
}

function clearSceneAndClose() {
  clearScene()
  emit('close')
}

function resetSceneAndClose() {
  resetScene()
  emit('close')
}

onMounted(() => { redraw() })
</script>

<template>
  <div class="editor-overlay" @click.self="emit('close')">
    <div class="editor-panel glass-panel">
      <div class="editor-header">
        <div class="section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none;">
          SCENARIO EDITOR
        </div>
        <button class="close-btn" @click="emit('close')">✕</button>
      </div>

      <div class="editor-tools">
        <button class="tool-btn" :class="{ active: mode === 'building' }" @click="mode = 'building'">
          🏢 建筑物
        </button>
        <button class="tool-btn" :class="{ active: mode === 'interference' }" @click="mode = 'interference'">
          ⚡ 干扰圈
        </button>
        <button class="tool-btn clear" @click="clearAll">🗑 清除</button>
      </div>

      <!-- 参数控制面板 -->
      <div class="param-row" v-if="mode === 'building'">
        <label>建筑高度</label>
        <input type="range" v-model.number="buildingHeight" min="20" max="200" step="5" />
        <span class="param-val">{{ buildingHeight }}m</span>
      </div>
      <div class="param-row" v-else>
        <label>干扰强度</label>
        <input type="range" v-model.number="zoneStrength" min="0.1" max="1.0" step="0.05" />
        <span class="param-val">{{ (zoneStrength * 100).toFixed(0) }}%</span>
      </div>

      <div class="editor-hint">
        {{ mode === 'building' ? '🖱 拖拽画矩形建筑（带 2.5D 高度预览）' : '🖱 从圆心拖拽画干扰圈' }}
        <span v-if="isDrawing" class="drawing-badge">绘制中...</span>
      </div>

      <canvas
        ref="canvasRef" :width="CANVAS_SIZE" :height="CANVAS_SIZE"
        class="editor-canvas"
        @mousedown="handleMouseDown" @mousemove="handleMouseMove"
        @mouseup="handleMouseUp" @mouseleave="handleMouseLeave"
      />

      <div class="editor-actions">
        <div class="obj-count">
          编辑器: {{ buildings.length }} 建筑 | {{ zones.length }} 干扰圈
        </div>
        <div class="action-btns">
          <button class="apply-btn" @click="applyAndClose">
            🚀 应用到 3D
          </button>
          <button class="export-btn" @click="exportScene">📤 导出</button>
        </div>
      </div>

      <div class="scene-mgmt">
        <button class="mgmt-btn danger" @click="clearSceneAndClose">
          🚫 清空 3D 场景（无建筑）
        </button>
        <button class="mgmt-btn" @click="resetSceneAndClose">
          🔄 恢复默认 CBD 场景
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-overlay {
  position: fixed; inset: 0; z-index: 2000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(6px);
}
.editor-panel { width: 560px; padding: 24px; animation: slideUp 0.3s ease; }
@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.editor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.close-btn {
  background: none; border: none; color: var(--text-dim);
  font-size: 16px; cursor: pointer; padding: 4px 8px;
}
.close-btn:hover { color: var(--text-primary); }
.editor-tools { display: flex; gap: 8px; margin-bottom: 8px; }
.tool-btn {
  flex: 1; padding: 8px; background: var(--bg-card);
  border: 1px solid var(--glass-border); color: var(--text-secondary);
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-body); font-size: 13px;
  transition: all var(--transition-fast);
}
.tool-btn:hover { border-color: var(--cyan); color: var(--cyan); }
.tool-btn.active { border-color: var(--cyan); color: var(--cyan); background: var(--cyan-dim); }
.tool-btn.clear { flex: 0.5; }
.tool-btn.clear:hover { border-color: var(--red); color: var(--red); }

.param-row {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 10px; margin-bottom: 6px;
  background: rgba(0, 242, 255, 0.03); border-radius: var(--radius-sm);
  border: 1px solid rgba(0, 242, 255, 0.06);
}
.param-row label {
  font-size: 12px; color: var(--text-dim); white-space: nowrap;
  font-family: var(--font-body); min-width: 56px;
}
.param-row input[type="range"] {
  flex: 1; accent-color: var(--cyan); height: 4px;
}
.param-val {
  font-family: var(--font-mono); font-size: 13px;
  color: var(--cyan); min-width: 50px; text-align: right;
}

.editor-hint {
  font-size: 12px; color: var(--text-dim); margin-bottom: 6px;
  display: flex; align-items: center; gap: 8px;
}
.drawing-badge {
  display: inline-block; padding: 2px 8px; border-radius: 10px;
  background: rgba(0, 242, 255, 0.15); color: var(--cyan);
  font-size: 10px; animation: pulse 1s infinite;
}
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.editor-canvas {
  width: 100%; border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm); cursor: crosshair;
}
.editor-actions {
  display: flex; justify-content: space-between; align-items: center; margin-top: 10px;
}
.obj-count { font-family: var(--font-mono); font-size: 12px; color: var(--text-dim); }
.action-btns { display: flex; gap: 8px; }
.apply-btn {
  padding: 8px 16px;
  background: linear-gradient(135deg, rgba(0, 242, 255, 0.2), rgba(168, 85, 247, 0.2));
  border: 1px solid var(--cyan); color: var(--cyan);
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-body); font-size: 13px;
  transition: all var(--transition-fast);
}
.apply-btn:hover { background: var(--cyan-dim); box-shadow: var(--cyan-glow); }
.apply-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.export-btn {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--glass-border); color: var(--text-secondary);
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-body); font-size: 13px;
  transition: all var(--transition-fast);
}
.export-btn:hover { border-color: var(--text-secondary); color: var(--text-primary); }

.scene-mgmt {
  display: flex; gap: 8px; margin-top: 8px;
  padding-top: 8px; border-top: 1px solid rgba(0, 242, 255, 0.06);
}
.mgmt-btn {
  flex: 1; padding: 6px 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--glass-border); color: var(--text-dim);
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-body); font-size: 11px;
  transition: all var(--transition-fast);
}
.mgmt-btn:hover { border-color: var(--text-secondary); color: var(--text-primary); }
.mgmt-btn.danger:hover { border-color: var(--red); color: var(--red); }
</style>

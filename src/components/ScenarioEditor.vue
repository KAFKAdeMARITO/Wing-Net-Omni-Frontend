<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import type { BuildingBlock, InterferenceZone, SceneConfig } from '../types'
import { applyScene, clearScene, resetScene, activeScene } from '../composables/useScene'

const emit = defineEmits<{
  (e: 'close'): void
}>()

// ── Refs ──
const containerRef = ref<HTMLDivElement | null>(null)
const GRID = 600

const mode = ref<'building' | 'interference'>('building')
const buildingWidth = ref(60)
const buildingDepth = ref(60)
const buildingHeight = ref(80)
const zoneRadius = ref(80)
const zoneStrength = ref(0.8)

const buildings = reactive<BuildingBlock[]>([])
const zones = reactive<InterferenceZone[]>([])

// Placement state
const isPlacing = ref(false)

// ── Three.js variables ──
let threeScene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let animId = 0
let groundPlane: THREE.Mesh
let gridHelper: THREE.GridHelper
let sceneGroup: THREE.Group  // holds placed buildings & zones
let ghostMesh: THREE.Mesh | null = null
let ghostZoneMesh: THREE.Mesh | null = null

// Camera orbit
let isDragging = false
let prevMouse = { x: 0, y: 0 }
let cameraAngle = { theta: Math.PI * 0.25, phi: Math.PI * 0.3 }
let cameraDistance = 550
let cameraTarget = new THREE.Vector3(GRID / 2, 0, GRID / 2)

// Raycaster for mouse → ground intersection
const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

// ── Camera controls ──
function updateCameraPosition() {
  if (!camera) return
  const x = cameraTarget.x + cameraDistance * Math.sin(cameraAngle.phi) * Math.cos(cameraAngle.theta)
  const y = cameraTarget.y + cameraDistance * Math.cos(cameraAngle.phi)
  const z = cameraTarget.z + cameraDistance * Math.sin(cameraAngle.phi) * Math.sin(cameraAngle.theta)
  camera.position.set(x, y, z)
  camera.lookAt(cameraTarget)
}

// ── Init Three.js Scene ──
function initScene() {
  if (!containerRef.value) return
  const w = containerRef.value.clientWidth
  const h = containerRef.value.clientHeight

  threeScene = new THREE.Scene()
  threeScene.fog = new THREE.FogExp2(0x040714, 0.0008)

  camera = new THREE.PerspectiveCamera(50, w / h, 1, 2000)
  updateCameraPosition()

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(w, h)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x040714)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  containerRef.value.appendChild(renderer.domElement)

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x1a2040, 1.5)
  threeScene.add(ambientLight)
  const dirLight = new THREE.DirectionalLight(0x4488cc, 0.8)
  dirLight.position.set(200, 400, 200)
  dirLight.castShadow = true
  threeScene.add(dirLight)
  const hemiLight = new THREE.HemisphereLight(0x0f1535, 0x000510, 0.6)
  threeScene.add(hemiLight)
  const pointLight1 = new THREE.PointLight(0x00f2ff, 0.4, 600)
  pointLight1.position.set(100, 100, 100)
  threeScene.add(pointLight1)

  // Ground plane (invisible, for raycasting)
  const groundGeo = new THREE.PlaneGeometry(GRID, GRID)
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x0a0e27, roughness: 0.9, metalness: 0.1,
  })
  groundPlane = new THREE.Mesh(groundGeo, groundMat)
  groundPlane.rotation.x = -Math.PI / 2
  groundPlane.position.set(GRID / 2, -0.5, GRID / 2)
  groundPlane.receiveShadow = true
  threeScene.add(groundPlane)

  // Grid
  gridHelper = new THREE.GridHelper(GRID, 12, 0x00f2ff, 0x00f2ff)
  gridHelper.position.set(GRID / 2, 0, GRID / 2)
  ;(gridHelper.material as THREE.Material).opacity = 0.08
  ;(gridHelper.material as THREE.Material).transparent = true
  threeScene.add(gridHelper)

  // Border
  const borderGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(GRID, 0.5, GRID))
  const borderMat = new THREE.LineBasicMaterial({ color: 0x00f2ff, transparent: true, opacity: 0.15 })
  const borderLine = new THREE.LineSegments(borderGeo, borderMat)
  borderLine.position.set(GRID / 2, 0, GRID / 2)
  threeScene.add(borderLine)

  // Scene group for placed objects
  sceneGroup = new THREE.Group()
  threeScene.add(sceneGroup)

  // Load current scene buildings into editor
  for (const b of activeScene.buildings) {
    buildings.push({ ...b })
  }
  for (const z of activeScene.interferenceZones) {
    zones.push({ ...z })
  }
  rebuildPlacedObjects()

  // Events
  renderer.domElement.addEventListener('mousedown', onMouseDown)
  renderer.domElement.addEventListener('mousemove', onMouseMove)
  renderer.domElement.addEventListener('mouseup', onMouseUp)
  renderer.domElement.addEventListener('wheel', onWheel)
  renderer.domElement.addEventListener('click', onClickPlace)
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault())
}

// ── Build placed objects in 3D ──
function rebuildPlacedObjects() {
  // Clear
  while (sceneGroup.children.length > 0) {
    const child = sceneGroup.children[0]
    sceneGroup.remove(child)
    if ((child as any).geometry) (child as any).geometry.dispose()
    if ((child as any).material) {
      const mat = (child as any).material
      if (Array.isArray(mat)) mat.forEach((m: any) => m.dispose())
      else mat.dispose()
    }
  }

  // Buildings
  for (const b of buildings) {
    addBuildingMesh(b)
  }

  // Zones
  for (const z of zones) {
    addZoneMesh(z)
  }
}

function addBuildingMesh(b: BuildingBlock) {
  const h = b.height * 0.8
  const geo = new THREE.BoxGeometry(b.width, h, b.depth)
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x0a1128,
    emissive: 0x001133,
    roughness: 0.1,
    metalness: 0.8,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    transparent: true,
    opacity: 0.9,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(b.x + b.width / 2, h / 2, b.y + b.depth / 2)
  mesh.castShadow = true
  mesh.receiveShadow = true
  sceneGroup.add(mesh)

  // Wireframe edges
  const edgeGeo = new THREE.EdgesGeometry(geo)
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x00f2ff, transparent: true, opacity: 0.25 })
  const edges = new THREE.LineSegments(edgeGeo, edgeMat)
  edges.position.copy(mesh.position)
  sceneGroup.add(edges)

  // Height label
  const labelSprite = createTextSprite(`${Math.round(b.height)}m`, '#00f2ff')
  labelSprite.position.set(b.x + b.width / 2, h + 8, b.y + b.depth / 2)
  labelSprite.scale.set(20, 10, 1)
  sceneGroup.add(labelSprite)
}

function addZoneMesh(z: InterferenceZone) {
  const geo = new THREE.RingGeometry(z.radius * 0.9, z.radius, 64)
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff3b3b,
    transparent: true,
    opacity: z.strength * 0.3,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(z.x, 0.5, z.y)
  sceneGroup.add(mesh)

  // Center dot
  const dotGeo = new THREE.SphereGeometry(3, 16, 16)
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b })
  const dot = new THREE.Mesh(dotGeo, dotMat)
  dot.position.set(z.x, 2, z.y)
  sceneGroup.add(dot)

  // Label
  const label = createTextSprite(`⚡${Math.round(z.strength * 100)}%`, '#ff3b3b')
  label.position.set(z.x, 12, z.y)
  label.scale.set(24, 12, 1)
  sceneGroup.add(label)
}

function createTextSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256; canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.font = 'bold 48px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 64)
  const tex = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true })
  return new THREE.Sprite(mat)
}

// ── Ghost mesh management ──
function createGhostBuilding() {
  removeGhost()
  const w = buildingWidth.value
  const d = buildingDepth.value
  const h = buildingHeight.value * 0.8
  const geo = new THREE.BoxGeometry(w, h, d)
  const mat = new THREE.MeshBasicMaterial({
    color: 0x00f2ff,
    transparent: true,
    opacity: 0.25,
    wireframe: false,
  })
  ghostMesh = new THREE.Mesh(geo, mat)
  ghostMesh.position.set(GRID / 2, h / 2, GRID / 2)
  threeScene.add(ghostMesh)

  // Ghost edges
  const edgeGeo = new THREE.EdgesGeometry(geo)
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x00f2ff, transparent: true, opacity: 0.7 })
  const edges = new THREE.LineSegments(edgeGeo, edgeMat)
  ghostMesh.add(edges)
}

function createGhostZone() {
  removeGhost()
  const r = zoneRadius.value
  const geo = new THREE.RingGeometry(r * 0.9, r, 64)
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff3b3b,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
  })
  ghostZoneMesh = new THREE.Mesh(geo, mat)
  ghostZoneMesh.rotation.x = -Math.PI / 2
  ghostZoneMesh.position.set(GRID / 2, 0.5, GRID / 2)
  threeScene.add(ghostZoneMesh)
}

function removeGhost() {
  if (ghostMesh) {
    threeScene.remove(ghostMesh)
    ghostMesh.geometry.dispose()
    ;(ghostMesh.material as THREE.Material).dispose()
    ghostMesh = null
  }
  if (ghostZoneMesh) {
    threeScene.remove(ghostZoneMesh)
    ghostZoneMesh.geometry.dispose()
    ;(ghostZoneMesh.material as THREE.Material).dispose()
    ghostZoneMesh = null
  }
}

// ── Start / Stop placement ──
function startPlacement() {
  isPlacing.value = true
  if (mode.value === 'building') {
    createGhostBuilding()
  } else {
    createGhostZone()
  }
  if (renderer) renderer.domElement.style.cursor = 'crosshair'
}

function stopPlacement() {
  isPlacing.value = false
  removeGhost()
  if (renderer) renderer.domElement.style.cursor = 'grab'
}

// ── Get ground intersection ──
function getGroundPoint(e: MouseEvent): THREE.Vector3 | null {
  if (!renderer || !camera) return null
  const rect = renderer.domElement.getBoundingClientRect()
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObject(groundPlane)
  if (intersects.length > 0) {
    const p = intersects[0].point
    // Clamp to grid bounds
    p.x = Math.max(0, Math.min(GRID, p.x))
    p.z = Math.max(0, Math.min(GRID, p.z))
    return p
  }
  return null
}

// ── Mouse events ──
function onMouseDown(e: MouseEvent) {
  if (isPlacing.value) return
  isDragging = true
  prevMouse = { x: e.clientX, y: e.clientY }
  if (renderer) renderer.domElement.style.cursor = 'grabbing'
}

function onMouseMove(e: MouseEvent) {
  if (isPlacing.value) {
    // Move ghost
    const point = getGroundPoint(e)
    if (point) {
      if (ghostMesh) {
        const h = buildingHeight.value * 0.8
        ghostMesh.position.set(point.x, h / 2, point.z)
      }
      if (ghostZoneMesh) {
        ghostZoneMesh.position.set(point.x, 0.5, point.z)
      }
    }
    return
  }

  if (!isDragging) return
  const dx = e.clientX - prevMouse.x
  const dy = e.clientY - prevMouse.y
  prevMouse = { x: e.clientX, y: e.clientY }

  if (e.shiftKey) {
    // Pan
    const right = new THREE.Vector3()
    camera.getWorldDirection(right)
    right.y = 0; right.normalize()
    const forward = right.clone()
    right.cross(new THREE.Vector3(0, 1, 0))
    cameraTarget.add(right.multiplyScalar(-dx * 0.5))
    cameraTarget.add(forward.multiplyScalar(dy * 0.5))
  } else {
    // Orbit
    cameraAngle.theta -= dx * 0.005
    cameraAngle.phi = Math.max(0.15, Math.min(Math.PI / 2 - 0.05, cameraAngle.phi - dy * 0.005))
  }
  updateCameraPosition()
}

function onMouseUp() {
  isDragging = false
  if (!isPlacing.value && renderer) renderer.domElement.style.cursor = 'grab'
}

function onWheel(e: WheelEvent) {
  cameraDistance = Math.max(100, Math.min(1200, cameraDistance + e.deltaY * 0.5))
  updateCameraPosition()
}

function onClickPlace(e: MouseEvent) {
  if (!isPlacing.value) return
  const point = getGroundPoint(e)
  if (!point) return

  if (mode.value === 'building') {
    const w = buildingWidth.value
    const d = buildingDepth.value
    const h = buildingHeight.value
    const b: BuildingBlock = {
      x: point.x - w / 2,
      y: point.z - d / 2,
      width: w, depth: d, height: h
    }
    buildings.push(b)
    addBuildingMesh(b)
    // Recreate ghost for next placement (with potentially updated params)
    createGhostBuilding()
  } else {
    const z: InterferenceZone = {
      x: point.x,
      y: point.z,
      radius: zoneRadius.value,
      strength: zoneStrength.value
    }
    zones.push(z)
    addZoneMesh(z)
    createGhostZone()
  }
}

// ── Watch param changes → update ghost ──
watch([buildingWidth, buildingDepth, buildingHeight], () => {
  if (isPlacing.value && mode.value === 'building' && ghostMesh) {
    const pos = ghostMesh.position.clone()
    createGhostBuilding()
    const h = buildingHeight.value * 0.8
    ghostMesh!.position.set(pos.x, h / 2, pos.z)
  }
})

watch([zoneRadius, zoneStrength], () => {
  if (isPlacing.value && mode.value === 'interference' && ghostZoneMesh) {
    const pos = ghostZoneMesh.position.clone()
    createGhostZone()
    ghostZoneMesh!.position.copy(pos)
  }
})

// ── Render loop ──
function animate() {
  animId = requestAnimationFrame(animate)
  if (renderer && threeScene && camera) {
    renderer.render(threeScene, camera)
  }
}

// ── Resize ──
function handleResize() {
  if (!containerRef.value || !renderer || !camera) return
  const w = containerRef.value.clientWidth
  const h = containerRef.value.clientHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
}

// ── Actions ──
function clearAll() {
  buildings.length = 0
  zones.length = 0
  rebuildPlacedObjects()
  stopPlacement()
}

function removeBuilding(index: number) {
  buildings.splice(index, 1)
  rebuildPlacedObjects()
}

function removeZone(index: number) {
  zones.splice(index, 1)
  rebuildPlacedObjects()
}

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
  stopPlacement()
  applyToSandbox()
  emit('close')
}

function clearSceneAndClose() {
  stopPlacement()
  clearScene()
  emit('close')
}

function resetSceneAndClose() {
  stopPlacement()
  resetScene()
  emit('close')
}

function switchMode(newMode: 'building' | 'interference') {
  mode.value = newMode
  if (isPlacing.value) {
    // Re-create ghost for new mode
    if (newMode === 'building') createGhostBuilding()
    else createGhostZone()
  }
}

let resizeOb: ResizeObserver | null = null

onMounted(() => {
  initScene()
  animate()
  resizeOb = new ResizeObserver(handleResize)
  if (containerRef.value) resizeOb.observe(containerRef.value)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(animId)
  resizeOb?.disconnect()
  stopPlacement()
  renderer?.domElement.removeEventListener('mousedown', onMouseDown)
  renderer?.domElement.removeEventListener('mousemove', onMouseMove)
  renderer?.domElement.removeEventListener('mouseup', onMouseUp)
  renderer?.domElement.removeEventListener('wheel', onWheel)
  renderer?.domElement.removeEventListener('click', onClickPlace)
  renderer?.dispose()
})
</script>

<template>
  <div class="editor-overlay" @click.self="emit('close')">
    <div class="editor-panel glass-panel">
      <div class="editor-header">
        <div class="section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none;">
          SCENARIO EDITOR — 3D
        </div>
        <button class="close-btn" @click="emit('close')">✕</button>
      </div>

      <div class="editor-body">
        <!-- Left: 3D Viewport -->
        <div ref="containerRef" class="viewport-3d"></div>

        <!-- Right: Controls Panel -->
        <div class="controls-panel">
          <!-- Mode switcher -->
          <div class="editor-tools">
            <button class="tool-btn" :class="{ active: mode === 'building' }" @click="switchMode('building')">
              🏢 建筑物
            </button>
            <button class="tool-btn" :class="{ active: mode === 'interference' }" @click="switchMode('interference')">
              ⚡ 干扰圈
            </button>
          </div>

          <!-- Building params -->
          <div v-if="mode === 'building'" class="param-group">
            <div class="param-row">
              <label>长度(X)</label>
              <input type="range" v-model.number="buildingWidth" min="20" max="200" step="5" />
              <span class="param-val">{{ buildingWidth }}m</span>
            </div>
            <div class="param-row">
              <label>宽度(Z)</label>
              <input type="range" v-model.number="buildingDepth" min="20" max="200" step="5" />
              <span class="param-val">{{ buildingDepth }}m</span>
            </div>
            <div class="param-row">
              <label>高度(Y)</label>
              <input type="range" v-model.number="buildingHeight" min="20" max="200" step="5" />
              <span class="param-val">{{ buildingHeight }}m</span>
            </div>
          </div>

          <!-- Zone params -->
          <div v-else class="param-group">
            <div class="param-row">
              <label>半径</label>
              <input type="range" v-model.number="zoneRadius" min="20" max="200" step="5" />
              <span class="param-val">{{ zoneRadius }}m</span>
            </div>
            <div class="param-row">
              <label>强度</label>
              <input type="range" v-model.number="zoneStrength" min="0.1" max="1.0" step="0.05" />
              <span class="param-val">{{ (zoneStrength * 100).toFixed(0) }}%</span>
            </div>
          </div>

          <!-- Placement toggle -->
          <button
            class="place-btn"
            :class="{ active: isPlacing }"
            @click="isPlacing ? stopPlacement() : startPlacement()"
          >
            <span v-if="isPlacing">⬛ 停止放置</span>
            <span v-else>➕ 开始放置</span>
          </button>

          <div class="editor-hint" v-if="isPlacing">
            {{ mode === 'building' ? '🖱 移动鼠标定位 → 单击放置建筑' : '🖱 移动鼠标定位 → 单击放置干扰圈' }}
            <span class="drawing-badge">放置中...</span>
          </div>
          <div class="editor-hint" v-else>
            🖱 拖拽旋转 | Shift+拖拽平移 | 滚轮缩放
          </div>

          <!-- Object list -->
          <div class="obj-list">
            <div class="obj-list-header">已放置对象</div>
            <div v-if="buildings.length === 0 && zones.length === 0" class="obj-list-empty">
              暂无对象
            </div>
            <div v-for="(b, i) in buildings" :key="'b'+i" class="obj-item building">
              <span>🏢 {{ Math.round(b.width) }}×{{ Math.round(b.depth) }}m H:{{ Math.round(b.height) }}m</span>
              <button class="obj-del" @click="removeBuilding(i)">✕</button>
            </div>
            <div v-for="(z, i) in zones" :key="'z'+i" class="obj-item zone">
              <span>⚡ r={{ Math.round(z.radius) }}m {{ (z.strength * 100).toFixed(0) }}%</span>
              <button class="obj-del" @click="removeZone(i)">✕</button>
            </div>
          </div>

          <!-- Actions -->
          <div class="action-btns">
            <button class="apply-btn" @click="applyAndClose">🚀 应用到 3D</button>
            <button class="export-btn" @click="exportScene">📤 导出</button>
          </div>

          <div class="scene-mgmt">
            <button class="mgmt-btn" @click="clearAll">🗑 清空编辑器</button>
            <button class="mgmt-btn danger" @click="clearSceneAndClose">🚫 清空 3D 场景</button>
            <button class="mgmt-btn" @click="resetSceneAndClose">🔄 恢复默认</button>
          </div>
        </div>
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
.editor-panel {
  width: 920px; max-width: 95vw; max-height: 90vh;
  padding: 20px; animation: slideUp 0.3s ease;
  display: flex; flex-direction: column;
}
@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.editor-header {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;
}
.close-btn {
  background: none; border: none; color: var(--text-dim);
  font-size: 16px; cursor: pointer; padding: 4px 8px;
}
.close-btn:hover { color: var(--text-primary); }

.editor-body {
  display: flex; gap: 16px; flex: 1; min-height: 0;
}

/* 3D Viewport */
.viewport-3d {
  flex: 1.4; min-height: 400px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  position: relative;
  cursor: grab;
}
.viewport-3d :deep(canvas) {
  display: block; width: 100% !important; height: 100% !important;
}

/* Controls */
.controls-panel {
  width: 280px; flex-shrink: 0;
  display: flex; flex-direction: column; gap: 8px;
  overflow-y: auto;
}

.editor-tools { display: flex; gap: 6px; }
.tool-btn {
  flex: 1; padding: 7px; background: var(--bg-card);
  border: 1px solid var(--glass-border); color: var(--text-secondary);
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-body); font-size: 12px;
  transition: all var(--transition-fast);
}
.tool-btn:hover { border-color: var(--cyan); color: var(--cyan); }
.tool-btn.active { border-color: var(--cyan); color: var(--cyan); background: var(--cyan-dim); }

.param-group { display: flex; flex-direction: column; gap: 4px; }
.param-row {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px;
  background: rgba(0, 242, 255, 0.03); border-radius: var(--radius-sm);
  border: 1px solid rgba(0, 242, 255, 0.06);
}
.param-row label {
  font-size: 11px; color: var(--text-dim); white-space: nowrap;
  font-family: var(--font-body); min-width: 48px;
}
.param-row input[type="range"] {
  flex: 1; accent-color: var(--cyan); height: 4px;
}
.param-val {
  font-family: var(--font-mono); font-size: 12px;
  color: var(--cyan); min-width: 44px; text-align: right;
}

.place-btn {
  padding: 8px 12px;
  background: linear-gradient(135deg, rgba(0, 242, 255, 0.1), rgba(168, 85, 247, 0.1));
  border: 1px solid var(--glass-border); color: var(--text-secondary);
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-body); font-size: 13px;
  transition: all var(--transition-fast);
}
.place-btn:hover {
  border-color: var(--cyan); color: var(--cyan);
  background: var(--cyan-dim);
}
.place-btn.active {
  border-color: var(--cyan); color: var(--cyan);
  background: var(--cyan-dim);
  animation: pulse 1.5s infinite;
}
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }

.editor-hint {
  font-size: 11px; color: var(--text-dim);
  display: flex; align-items: center; gap: 6px;
  flex-wrap: wrap;
}
.drawing-badge {
  display: inline-block; padding: 2px 8px; border-radius: 10px;
  background: rgba(0, 242, 255, 0.15); color: var(--cyan);
  font-size: 10px; animation: pulse 1s infinite;
}

/* Object list */
.obj-list {
  flex: 1; min-height: 60px; max-height: 180px;
  overflow-y: auto;
  border: 1px solid rgba(0, 242, 255, 0.06);
  border-radius: var(--radius-sm);
  padding: 6px;
}
.obj-list-header {
  font-size: 10px; color: var(--text-dim); text-transform: uppercase;
  letter-spacing: 1px; margin-bottom: 4px;
  font-family: var(--font-display);
}
.obj-list-empty {
  font-size: 11px; color: var(--text-dim); text-align: center; padding: 8px;
}
.obj-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 6px; margin-bottom: 2px;
  border-radius: 4px; font-size: 11px;
  font-family: var(--font-mono);
}
.obj-item.building {
  color: var(--cyan); background: rgba(0, 242, 255, 0.04);
}
.obj-item.zone {
  color: #ff6b6b; background: rgba(255, 59, 59, 0.04);
}
.obj-del {
  background: none; border: none; color: var(--text-dim);
  cursor: pointer; font-size: 12px; padding: 2px 4px;
  transition: color 0.15s;
}
.obj-del:hover { color: #ff3b3b; }

/* Action buttons */
.action-btns { display: flex; gap: 6px; }
.apply-btn {
  flex: 1; padding: 8px 12px;
  background: linear-gradient(135deg, rgba(0, 242, 255, 0.2), rgba(168, 85, 247, 0.2));
  border: 1px solid var(--cyan); color: var(--cyan);
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-body); font-size: 13px;
  transition: all var(--transition-fast);
}
.apply-btn:hover { background: var(--cyan-dim); box-shadow: var(--cyan-glow); }
.export-btn {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--glass-border); color: var(--text-secondary);
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-body); font-size: 12px;
  transition: all var(--transition-fast);
}
.export-btn:hover { border-color: var(--text-secondary); color: var(--text-primary); }

.scene-mgmt {
  display: flex; gap: 4px; flex-wrap: wrap;
  padding-top: 6px; border-top: 1px solid rgba(0, 242, 255, 0.06);
}
.mgmt-btn {
  flex: 1; padding: 5px 8px; min-width: 80px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--glass-border); color: var(--text-dim);
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-body); font-size: 10px;
  transition: all var(--transition-fast);
}
.mgmt-btn:hover { border-color: var(--text-secondary); color: var(--text-primary); }
.mgmt-btn.danger:hover { border-color: var(--red); color: var(--red); }
</style>

<script setup lang="ts">
import { ref, inject, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import type { UAVNode, BuildingBlock, UAVMeshUserData } from '../types'
import { activeScene, sceneVersion, missionWaypoints, interactionState, sceneMode, geojsonMapData } from '../composables/useScene'
import { useAppMode } from '../composables/useAppMode'
import { useWorkspaceStore } from '../composables/workspaceStore'

// Hover tooltip state
const hoverInfo = ref<{ show: boolean; x: number; y: number; uav: UAVNode | null }>({
  show: false, x: 0, y: 0, uav: null
})
const selectedUAVId = inject<any>('selectedUAVId')
const { currentAppMode, currentScene } = useAppMode()
const { workspaceData } = useWorkspaceStore()

const emit = defineEmits<{
  (e: 'select-uav', uav: UAVNode | null): void
}>()

const engine = inject<any>('engine')
const frame = computed(() => engine?.currentFrame?.value)
const totalTicks = computed(() => engine?.totalTicks?.value ?? 0)
const currentTick = computed(() => engine?.currentTick?.value ?? 0)

const containerRef = ref<HTMLDivElement | null>(null)

// Three.js core
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let composer: EffectComposer
let animId = 0
let clock: THREE.Clock

// Objects
let uavMeshes: Map<number, THREE.Group> = new Map()
let linkLines: THREE.Group
let trailGroup: THREE.Group
let sceneGroup: THREE.Group  // Rebuildable buildings + zones
let groundGroup: THREE.Group | null = null // Rebuildable dynamic ground
let interpPositions: Map<number, { x: number; y: number; z: number }> = new Map()
let uavTrails: Map<number, THREE.Vector3[]> = new Map()
let trailLines: Map<number, THREE.Line> = new Map()
let starField: THREE.Points
let envParticles: THREE.Points

// Interference zone dynamic meshes (for animate pulse) — removed

// Reusable geometries/materials for performance
const linkMat = new THREE.LineBasicMaterial({ transparent: true, vertexColors: true })
const flowPointMat = new THREE.PointsMaterial({
  size: 1.5,
  transparent: true,
  opacity: 0.6,
  sizeAttenuation: true,
  vertexColors: true
})
let linkSegmentsMesh: THREE.LineSegments | null = null
let flowPointsMesh: THREE.Points | null = null

const MAX_LINKS = 500
const linkPosBuffer = new Float32Array(MAX_LINKS * 6)
const linkColBuffer = new Float32Array(MAX_LINKS * 8)
const MAX_FLOW = MAX_LINKS * 3
const flowPosBuffer = new Float32Array(MAX_FLOW * 3)
const flowColBuffer = new Float32Array(MAX_FLOW * 4)

let hoverThrottleTimer = 0
const HOVER_THROTTLE_MS = 50  // 50ms = 最多 20fps 的 hover 检测

// 预分配相机平移向量（避免 onMouseMove 每次 new Vector3）
const _panFwd = new THREE.Vector3()
const _panRight = new THREE.Vector3()

let envParticleFrameSkip = 0

// Waypoint markers
let startMarkerRaw: THREE.Group | null = null
let targetMarkerRaw: THREE.Group | null = null

// Topology Link Animation state
let previousFrameLinks = new Set<string>()
const brokenLinkParticles: { obj: THREE.Group; timeRemaining: number }[] = []
let brokenLinksGroup: THREE.Group | null = null

// Mouse
let raycaster = new THREE.Raycaster()
let mouse = new THREE.Vector2()
let isDragging = false
let prevMouse = { x: 0, y: 0 }
let cameraAngle = { theta: Math.PI * 0.25, phi: Math.PI * 0.3 }
let cameraDistance = 500
let cameraTarget = new THREE.Vector3(300, 0, 300)

const GRID = 600
const channelColors = [0x23d7e6, 0x8e82ff, 0x22c55e]
const channelHexStr = ['#23d7e6', '#8e82ff', '#22c55e']

// GeoJSON Transform State (Synchronized with Building generation)
const geojsonTransform = { scale: 1, offsetX: 0, offsetZ: 0 }
let shouldAutoFocusOnNextDataset = false

/** 实时 NLOS 检测: 基于 activeScene 的当前建筑物 (包含高度检查) */
function checkNLOSDynamic(x: number, y: number, z: number): boolean {
  if (!activeScene?.buildings?.length) return false
  for (const b of activeScene.buildings) {
    const dx = x - (b.x + b.width / 2)
    const dy = y - (b.y + b.depth / 2)
    const dist = Math.sqrt(dx * dx + dy * dy)
    // 距离 < 半径 + 缓冲 且 高度 < 建筑高度 + 缓冲
    if (dist < (b.width + b.depth) / 2 + 15 && z < b.height + 5) return true
  }
  return false
}

function initScene() {
  if (!containerRef.value) return

  const w = containerRef.value.clientWidth
  const h = containerRef.value.clientHeight

  // Scene
  scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x132033, 0.00072)

  // Camera
  camera = new THREE.PerspectiveCamera(50, w / h, 1, 2000)
  updateCameraPosition()

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(w, h)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x132033)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  containerRef.value.appendChild(renderer.domElement)
  renderer.domElement.style.cursor = 'grab'

  clock = new THREE.Clock()

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x25365a, 1.7)
  scene.add(ambientLight)

  const dirLight = new THREE.DirectionalLight(0x73a8de, 0.92)
  dirLight.position.set(200, 400, 200)
  dirLight.castShadow = true
  dirLight.shadow.mapSize.set(1024, 1024)
  dirLight.shadow.camera.near = 50
  dirLight.shadow.camera.far = 1000
  dirLight.shadow.camera.left = -400
  dirLight.shadow.camera.right = 400
  dirLight.shadow.camera.top = 400
  dirLight.shadow.camera.bottom = -400
  scene.add(dirLight)

  const hemiLight = new THREE.HemisphereLight(0x1f3151, 0x09101d, 0.72)
  scene.add(hemiLight)

  // Cyan point lights for atmosphere
  const pointLight1 = new THREE.PointLight(0x00f2ff, 0.4, 600)
  pointLight1.position.set(100, 100, 100)
  scene.add(pointLight1)
  const pointLight2 = new THREE.PointLight(0xa855f7, 0.3, 600)
  pointLight2.position.set(500, 80, 500)
  scene.add(pointLight2)

  // Ground (static)
  createGround()

  // Initialize shared geometries for UAV models
  initSharedGeo()

  // Starfield background
  createStarfield()

  // Floating environment particles
  createEnvParticles()

  // Rebuildable scene objects
  sceneGroup = new THREE.Group()
  scene.add(sceneGroup)
  rebuildSceneObjects()

  // Groups for dynamic objects
  trailGroup = new THREE.Group()
  scene.add(trailGroup)
  brokenLinksGroup = new THREE.Group()
  scene.add(brokenLinksGroup)

  // Initialize unified link meshes
  const linkGeo = new THREE.BufferGeometry()
  linkSegmentsMesh = new THREE.LineSegments(linkGeo, linkMat)
  linkSegmentsMesh.frustumCulled = false
  scene.add(linkSegmentsMesh)

  const flowGeo = new THREE.BufferGeometry()
  flowPointsMesh = new THREE.Points(flowGeo, flowPointMat)
  flowPointsMesh.frustumCulled = false
  scene.add(flowPointsMesh)

  // Events
  renderer.domElement.addEventListener('mousedown', onMouseDown)
  renderer.domElement.addEventListener('mousemove', onMouseMove)
  renderer.domElement.addEventListener('mouseup', onMouseUp)
  renderer.domElement.addEventListener('wheel', onWheel)
  renderer.domElement.addEventListener('click', onClick)
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault())

  // Post-processing (Bloom)
  const renderPass = new RenderPass(scene, camera)
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 1.5, 0.4, 0.85)
  bloomPass.threshold = 0.15
  bloomPass.strength = 1.0  // 辉光强度
  bloomPass.radius = 0.5
  
  composer = new EffectComposer(renderer)
  composer.addPass(renderPass)
  composer.addPass(bloomPass)
}

function createStarfield() {
  const starCount = 600
  const positions = new Float32Array(starCount * 3)
  const sizes = new Float32Array(starCount)
  for (let i = 0; i < starCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 2000
    positions[i * 3 + 1] = Math.random() * 800 + 100
    positions[i * 3 + 2] = (Math.random() - 0.5) * 2000
    sizes[i] = Math.random() * 2 + 0.5
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
  const mat = new THREE.PointsMaterial({
    color: 0xaaccff,
    size: 1.5,
    transparent: true,
    opacity: 0.6,
    sizeAttenuation: true,
  })
  starField = new THREE.Points(geo, mat)
  scene.add(starField)
}

function createEnvParticles() {
  const count = 200
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = Math.random() * GRID
    positions[i * 3 + 1] = Math.random() * 120 + 5
    positions[i * 3 + 2] = Math.random() * GRID
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    color: 0x00f2ff,
    size: 1.2,
    transparent: true,
    opacity: 0.25,
    sizeAttenuation: true,
  })
  envParticles = new THREE.Points(geo, mat)
  scene.add(envParticles)
}

function createGround() {
  if (groundGroup) {
    scene.remove(groundGroup)
  }
  groundGroup = new THREE.Group()

  const isForest = currentScene.value === 'forest'
  const isWild = currentScene.value === 'wild'
  const isOpen = currentScene.value === 'open'

  const gColor = isForest ? 0x08150f : (isWild ? 0x6b5331 : (isOpen ? 0x07121d : 0x060b18))
  const gGrid = isForest ? 0x34f5a1 : (isWild ? 0xffd36a : (isOpen ? 0x73c7ff : 0x2ed8e6))

  if (isOpen) {
    // Lake: keep the composition clean and improve readability via water color/material only
    const shoreGeo = new THREE.PlaneGeometry(GRID, GRID)
    const shoreMat = new THREE.MeshStandardMaterial({
      color: 0x142236,
      roughness: 0.98,
      metalness: 0.02,
    })
    const shore = new THREE.Mesh(shoreGeo, shoreMat)
    shore.rotation.x = -Math.PI / 2
    shore.position.set(GRID / 2, -1.2, GRID / 2)
    shore.receiveShadow = true
    groundGroup.add(shore)

    const waterSize = GRID * 0.82
    const waterGeo = new THREE.PlaneGeometry(waterSize, waterSize, 72, 72)
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x2a6f8f,
      roughness: 0.34,
      metalness: 0.08,
    })
    const water = new THREE.Mesh(waterGeo, waterMat)
    water.name = 'OceanGround'
    water.rotation.x = -Math.PI / 2
    water.position.set(GRID / 2, -0.35, GRID / 2)
    water.receiveShadow = true
    water.userData.isGround = true
    groundGroup.add(water)
  } else if (isWild) {
    const terrainGeo = new THREE.PlaneGeometry(GRID, GRID, 48, 48)
    const pos = terrainGeo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const broad = Math.sin(x * 0.011) * 7 + Math.cos(y * 0.009) * 6
      const detail = Math.sin((x + y) * 0.016) * 2.5
      pos.setZ(i, broad + detail)
    }
    terrainGeo.computeVertexNormals()

    const terrainMat = new THREE.MeshStandardMaterial({
      color: gColor,
      roughness: 0.9,
      metalness: 0.01,
      emissive: 0x1f1407,
    })
    const terrain = new THREE.Mesh(terrainGeo, terrainMat)
    terrain.rotation.x = -Math.PI / 2
    terrain.position.set(GRID / 2, 6.5, GRID / 2)
    terrain.receiveShadow = true
    terrain.userData.isGround = true
    groundGroup.add(terrain)

    createOpenFieldFeatures(groundGroup)
  } else {
    const groundGeo = new THREE.PlaneGeometry(GRID, GRID, 1, 1)
    const groundMat = new THREE.MeshStandardMaterial({
      color: gColor,
      roughness: 0.98,
      metalness: 0.02,
    })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.position.set(GRID / 2, -0.5, GRID / 2)
    ground.receiveShadow = true
    ground.userData.isGround = true
    groundGroup.add(ground)
  }

  // Grid helper
  const gridHelper = new THREE.GridHelper(GRID, 12, gGrid, gGrid)
  gridHelper.position.set(GRID / 2, 0, GRID / 2)
  gridHelper.material.opacity = isWild ? 0 : 0.12
  gridHelper.material.transparent = true
  groundGroup.add(gridHelper)

  // Glowing edge border
  const borderGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(GRID, 0.5, GRID))
  const borderMat = new THREE.LineBasicMaterial({ color: gGrid, transparent: true, opacity: isWild ? 0.03 : 0.24 })
  const borderLine = new THREE.LineSegments(borderGeo, borderMat)
  borderLine.position.set(GRID / 2, 0, GRID / 2)
  groundGroup.add(borderLine)
  
  scene.add(groundGroup)
}

function createOpenFieldFeatures(target: THREE.Group) {
  const ridgeMat = new THREE.MeshStandardMaterial({
    color: 0xb8843e,
    roughness: 0.94,
    metalness: 0.02,
    emissive: 0x2c1706,
    flatShading: true,
  })
  const plateauMat = new THREE.MeshStandardMaterial({
    color: 0xe0b56a,
    roughness: 0.88,
    metalness: 0.02,
    emissive: 0x332008,
  })
  const scrubMat = new THREE.MeshStandardMaterial({
    color: 0xf0cf8b,
    roughness: 0.9,
    metalness: 0,
    emissive: 0x3b2609,
  })

  const ridgeSpecs = [
    { x: 135, z: 145, sx: 96, sy: 24, sz: 46, rot: 0.32 },
    { x: 318, z: 252, sx: 132, sy: 30, sz: 58, rot: -0.4 },
    { x: 472, z: 414, sx: 88, sy: 20, sz: 42, rot: 0.24 },
    { x: 208, z: 438, sx: 76, sy: 16, sz: 34, rot: -0.18 },
  ]

  for (const ridge of ridgeSpecs) {
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 1), ridgeMat)
    mesh.scale.set(ridge.sx, ridge.sy, ridge.sz)
    mesh.position.set(ridge.x, 10 + ridge.sy * 0.45, ridge.z)
    mesh.rotation.y = ridge.rot
    mesh.castShadow = true
    mesh.receiveShadow = true
    target.add(mesh)
  }

  const plateauSpecs = [
    { x: 102, z: 326, sx: 62, sy: 6, sz: 28, rot: 0.16 },
    { x: 255, z: 108, sx: 86, sy: 8, sz: 34, rot: -0.12 },
    { x: 426, z: 224, sx: 72, sy: 7, sz: 32, rot: 0.28 },
    { x: 500, z: 516, sx: 64, sy: 5, sz: 26, rot: -0.22 },
  ]
  for (const plateau of plateauSpecs) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), plateauMat)
    mesh.scale.set(plateau.sx, plateau.sy, plateau.sz)
    mesh.position.set(plateau.x, 10 + plateau.sy * 0.45, plateau.z)
    mesh.rotation.y = plateau.rot
    mesh.castShadow = true
    mesh.receiveShadow = true
    target.add(mesh)
  }

  const scrubSpecs = [
    { x: 78, z: 248, sx: 42, sy: 1.2, sz: 16, rot: 0.2 },
    { x: 192, z: 520, sx: 56, sy: 1.4, sz: 18, rot: -0.1 },
    { x: 348, z: 150, sx: 50, sy: 1.1, sz: 15, rot: 0.3 },
    { x: 540, z: 302, sx: 44, sy: 1.3, sz: 17, rot: -0.26 },
  ]
  for (const scrub of scrubSpecs) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6), scrubMat)
    mesh.scale.set(scrub.sx, scrub.sy, scrub.sz)
    mesh.position.set(scrub.x, 8.5, scrub.z)
    mesh.rotation.y = scrub.rot
    mesh.castShadow = true
    mesh.receiveShadow = true
    target.add(mesh)
  }
}

function createBuildings() {
  if (!activeScene?.buildings?.length) return
  const isForest = currentScene.value === 'forest'
  const isWild = currentScene.value === 'wild'
  const isOpen = currentScene.value === 'open'
  const bColor = isForest ? 0x1d3a2b : (isWild ? 0x4a3822 : (isOpen ? 0x21405e : 0x22324d))
  const eColor = isForest ? 0x5bffb3 : (isWild ? 0xf6d36f : (isOpen ? 0x8cd2ff : 0x58ebff))

  const mat = new THREE.MeshPhysicalMaterial({
    color: bColor, 
    emissive: isForest ? 0x07150e : (isWild ? 0x1a130a : 0x0c1a28),
    roughness: isForest || isWild ? 0.92 : 0.58,
    metalness: isForest || isWild ? 0.04 : 0.16,
    clearcoat: isForest || isWild ? 0.0 : 0.18,
    clearcoatRoughness: 0.3,
    transparent: false,
    opacity: 1,
  })
  
  const edgeMat = new THREE.LineBasicMaterial({
    color: eColor,
    transparent: true,
    opacity: 0.42,
  })

  // pre-generate geometries for performance
  const trunkGeo = new THREE.CylinderGeometry(2, 3, 1, 8)
  const leavesGeo = new THREE.ConeGeometry(1, 1, 8)

  // 视觉夸张比例：将自然地形在 Z(Y) 轴上拉高 2.5 倍以增强俯视视角下的冲击力，而不改变其实际遮挡高度计算(25~60m)
  const visualScale = (isForest || isWild) ? 2.5 : 1.0;

  for (const b of activeScene.buildings) {
    const h = b.height
    const renderH = h * visualScale

    if (isForest) {
      // 真实一点的树木：树干 + 多层锥体树叶
      const trunkH = Math.max(8, renderH * 0.2)
      const trunk = new THREE.Mesh(trunkGeo, mat)
      trunk.scale.set(1, trunkH, 1)
      trunk.position.set(b.x + b.width / 2, trunkH / 2, b.y + b.depth / 2)
      trunk.castShadow = true
      sceneGroup.add(trunk)
      
      const leafColorMat = mat.clone()
      leafColorMat.color.setHex(0x244a34)
      
      for (let i = 0; i < 3; i++) {
        const leafH = renderH * 0.4
        const leafW = b.width * (1 - i * 0.25)
        const leaves = new THREE.Mesh(leavesGeo, leafColorMat)
        leaves.scale.set(leafW, leafH, leafW)
        leaves.position.set(b.x + b.width / 2, trunkH + i * (leafH * 0.5) + leafH / 2, b.y + b.depth / 2)
        leaves.castShadow = true
        sceneGroup.add(leaves)
        
        // 线框
        const edgeG = new THREE.EdgesGeometry(leavesGeo)
        const edges = new THREE.LineSegments(edgeG, edgeMat)
        edges.scale.copy(leaves.scale)
        edges.position.copy(leaves.position)
        sceneGroup.add(edges)
      }
    } else if (isWild) {
      // 丘陵野地：多边形低面建模山峰 (Low-Poly Cyber Mountains)
      const r = Math.max(b.width, b.depth) * 1.5 // 加宽山体底部，不改变高度计算
      
      // 使用 4~6 条边的圆锥体，配合 flatShading 产生极具科幻质感的低多边形山脉效果
      const segments = 4 + Math.floor(Math.random() * 3)
      const hillGeo = new THREE.ConeGeometry(r, renderH, segments)
      
      const hillBaseMat = mat.clone()
      hillBaseMat.color.setHex(0x2a1d10) // 赋予略微更深邃的岩石泥土底色
      hillBaseMat.flatShading = true     // 开启 Low-poly 效果，反射棱角分明的光影
      hillBaseMat.roughness = 1.0
      
      const hill = new THREE.Mesh(hillGeo, hillBaseMat)
      hill.rotation.y = Math.random() * Math.PI // 随机旋转让每座山看起来都不一样
      hill.position.set(b.x + b.width / 2, renderH / 2, b.y + b.depth / 2)
      hill.castShadow = true
      hill.receiveShadow = true
      sceneGroup.add(hill)

      const edgeG = new THREE.EdgesGeometry(hillGeo)
      const edges = new THREE.LineSegments(edgeG, edgeMat)
      edges.rotation.y = hill.rotation.y
      edges.position.copy(hill.position)
      sceneGroup.add(edges)
      
    } else {
      // 城市大楼：标志性的发光全息矩形
      const geo = new THREE.BoxGeometry(b.width, renderH, b.depth)
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(b.x + b.width / 2, renderH / 2, b.y + b.depth / 2)
      mesh.castShadow = true
      mesh.receiveShadow = true
      sceneGroup.add(mesh)

      const edgeGeo = new THREE.EdgesGeometry(geo)
      const edges = new THREE.LineSegments(edgeGeo, edgeMat)
      edges.position.copy(mesh.position)
      sceneGroup.add(edges)

      createWindowLights(b, renderH)
    }

    // 统一的高度标签，依然显示绝对真实的高度 h，但是文字挂点上升到模型顶部 renderH + 8 的位置
    const labelSprite = createTextSprite(`${Math.round(h)}m`, '#f7fbff')
    labelSprite.position.set(b.x + b.width / 2, renderH + 8, b.y + b.depth / 2)
    labelSprite.scale.set(20, 10, 1)
    sceneGroup.add(labelSprite)
  }
}

/**
 * GeoJSON 模式：用 ExtrudeGeometry + Shape 渲染真实多边形建筑
 * 坐标自动缩放以适应 GRID 沙盘，保持宽高比
 */
function createGeoJsonBuildings() {
  const mapData = geojsonMapData.value
  if (!mapData || !mapData.buildings.length) return

  // 计算缩放比例，使整个地图适配 GRID
  const scale = Math.min(
    GRID / Math.max(mapData.map_width, 1),
    GRID / Math.max(mapData.map_height, 1)
  )
  const offsetX = (GRID - mapData.map_width * scale) / 2
  const offsetZ = (GRID - mapData.map_height * scale) / 2

  // Update global transform
  geojsonTransform.scale = scale
  geojsonTransform.offsetX = offsetX
  geojsonTransform.offsetZ = offsetZ

  // 超过 500 栋时仅渲染部分细节以保持性能
  const MAX_LABELED = 100

  for (let idx = 0; idx < mapData.buildings.length; idx++) {
    const b = mapData.buildings[idx]
    const bHeight = (b.zMax ?? 20) * scale

    // 获取路径列表：单路径(polygon) 或 多路径(polygons)
    const pathList = b.polygons ?? (b.polygon ? [b.polygon] : null)
    if (!pathList || pathList.length === 0) continue

    // ─── 坐标系说明 ───────────────────────────────────────────
    // Three.js 场景：Y 轴朝上，XZ 为水平面
    // OSM 数据：x→X，y→Z（水平），高度→Y
    // ExtrudeGeometry 在 XY 平面绘形，沿 +Z 挤压
    // 所以 Shape 里用 (osmX, osmY)，挤压方向最终要变成 Three.js 的 +Y
    //
    // 解决方案：给 geometry 直接 applyMatrix4 变换（-90° 绕 X），
    // 然后把 geometry 的坐标按旋转后的映射手动平移到正确位置：
    //   旋转 -90° 绕 X 后：
    //     原 X → 仍是 X    (水平)
    //     原 Y → 变成 -Z   (需要 +offsetZ 补偿)
    //     原 Z → 变成  Y   (挤压方向变成高度，已正确)
    // ──────────────────────────────────────────────────────────

    const shape = new THREE.Shape()
    let isFirst = true

    for (const pts of pathList) {
      if (!pts || pts.length < 3) continue
      if (isFirst) {
        // Shape 的 X = osmX（映射到 Three.js X），Shape 的 Y = osmY（映射到 Three.js Z after rotation）
        // Invert Y for North-Up Map: (H - Y)
        shape.moveTo(
          pts[0].x * scale + offsetX,
          (mapData.map_height - pts[0].y) * scale + offsetZ
        )
        for (let i = 1; i < pts.length; i++) {
          shape.lineTo(
            pts[i].x * scale + offsetX,
            (mapData.map_height - pts[i].y) * scale + offsetZ
          )
        }
        shape.closePath()
        isFirst = false
      } else {
        const hole = new THREE.Path()
        hole.moveTo(
          pts[0].x * scale + offsetX, 
          (mapData.map_height - pts[0].y) * scale + offsetZ
        )
        for (let i = 1; i < pts.length; i++) {
          hole.lineTo(
            pts[i].x * scale + offsetX, 
            (mapData.map_height - pts[i].y) * scale + offsetZ
          )
        }
        hole.closePath()
        shape.holes.push(hole)
      }
    }

    // ExtrudeGeometry：shape 在 XY 平面（x=osmX, y=osmY），depth 沿 +Z 挤压（挤压量=建筑高度）
    // 需要映射到 Three.js 场景坐标（Y 轴朝上）：
    //   Three.js X = shape.x  （osmX，水平）
    //   Three.js Y = extrude Z（挤压方向 → 建筑高度）
    //   Three.js Z = shape.y  （osmY，水平另一轴）
    // 变换矩阵：newX=x, newY=z, newZ=y
    const geo = new THREE.ExtrudeGeometry(shape, { depth: bHeight, bevelEnabled: false })

    const mat4 = new THREE.Matrix4()
    // Column-major: set(n11,n12,...) 是行优先
    // [1, 0, 0, 0]   X → X
    // [0, 0, 1, 0]   Z → Y (挤压方向变高度)
    // [0, 1, 0, 0]   Y → Z (shape.y 变成水平 Z)
    // [0, 0, 0, 1]
    mat4.set(
      1, 0, 0, 0,
      0, 0, 1, 0,
      0, 1, 0, 0,
      0, 0, 0, 1
    )
    geo.applyMatrix4(mat4)

    const buildingMat = new THREE.MeshPhysicalMaterial({
      color: 0x22324d,
      emissive: 0x0c1a28,
      roughness: 0.58,
      metalness: 0.16,
      clearcoat: 0.18,
      clearcoatRoughness: 0.3,
      transparent: false,
      opacity: 1,
    })

    const mesh = new THREE.Mesh(geo, buildingMat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    sceneGroup.add(mesh)

    // 边框线框
    const edgeGeo = new THREE.EdgesGeometry(geo)
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x58ebff, transparent: true, opacity: 0.42 })
    const edges = new THREE.LineSegments(edgeGeo, edgeMat)
    sceneGroup.add(edges)

    // 高度标注（限量）
    if (idx < MAX_LABELED) {
      const firstPts = pathList[0]
      const cx = firstPts.reduce((s, p) => s + p.x, 0) / firstPts.length * scale + offsetX
      const cz = firstPts.reduce((s, p) => s + p.y, 0) / firstPts.length * scale + offsetZ
      const label = createTextSprite(`${Math.round(b.zMax)}m`, '#f7fbff')
      label.position.set(cx, bHeight + 6, cz)
      label.scale.set(16, 8, 1)
      sceneGroup.add(label)
    }
  }

  // GeoJSON 模式专属：沙盘底部 label 显示建筑数量
  if (mapData.buildings.length > 0) {
    const mapLabel = createTextSprite(
      `GeoJSON · ${mapData.buildings.length} bldgs`,
      '#f7fbff'
    )
    mapLabel.position.set(GRID / 2, 5, GRID + 15)
    mapLabel.scale.set(60, 20, 1)
    sceneGroup.add(mapLabel)
  }
}

function createWindowLights(b: BuildingBlock, h: number) {
  const windowGeo = new THREE.PlaneGeometry(2, 2)
  const windowMat = new THREE.MeshBasicMaterial({
    color: 0x00f2ff,
    transparent: true,
    opacity: 0.15,
  })

  // Front face windows
  for (let wy = 4; wy < h - 4; wy += 8) {
    for (let wx = 4; wx < b.width - 4; wx += 8) {
      if (Math.random() > 0.4) {
        const win = new THREE.Mesh(windowGeo, windowMat)
        win.position.set(b.x + wx, wy, b.y - 0.1)
        sceneGroup.add(win)
      }
    }
  }

  // Side face windows
  for (let wy = 4; wy < h - 4; wy += 8) {
    for (let wz = 4; wz < b.depth - 4; wz += 8) {
      if (Math.random() > 0.4) {
        const win = new THREE.Mesh(windowGeo, windowMat)
        win.rotation.y = Math.PI / 2
        win.position.set(b.x + b.width + 0.1, wy, b.y + wz)
        sceneGroup.add(win)
      }
    }
  }
}

function createTextSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 256, 128)
  ctx.fillStyle = 'rgba(6, 11, 24, 0.84)'
  ctx.strokeStyle = 'rgba(120, 235, 255, 0.3)'
  ctx.lineWidth = 2
  roundRect(ctx, 24, 26, 208, 76, 16)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = color
  ctx.font = 'bold 36px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 64)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  return new THREE.Sprite(mat)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

// ═══════════════════════════════════════════════════════
// 材质共享池 — 按频道/部件复用，消除重复创建
// ═══════════════════════════════════════════════════════
const materialPool = {
  body: new Map<number, THREE.MeshPhysicalMaterial>(),
  arm: null as THREE.MeshStandardMaterial | null,
  armRogue: null as THREE.MeshStandardMaterial | null,
  prop: new Map<number, THREE.MeshBasicMaterial>(),
  propBlur: new Map<number, THREE.MeshBasicMaterial>(),
  aura: new Map<number, THREE.MeshBasicMaterial>(),
  shield: new Map<number, THREE.MeshBasicMaterial>(),
  glowSprite: new Map<number, THREE.SpriteMaterial>(),
  motor: null as THREE.MeshStandardMaterial | null,
  rogueHull: null as THREE.MeshBasicMaterial | null,
  rogueBody: null as THREE.MeshPhysicalMaterial | null,
}

// 光晕纹理（唯一一份，所有机共用）
let glowTexture: THREE.Texture | null = null
function getGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.3, 'rgba(255,255,255,0.5)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  glowTexture = new THREE.CanvasTexture(canvas)
  return glowTexture
}

function getBodyMat(color: number): THREE.MeshPhysicalMaterial {
  if (!materialPool.body.has(color)) {
    materialPool.body.set(color, new THREE.MeshPhysicalMaterial({
      color, emissive: color, emissiveIntensity: 0.5,
      roughness: 0.2, metalness: 0.7, clearcoat: 0.7, clearcoatRoughness: 0.3,
    }))
  }
  return materialPool.body.get(color)!
}
function getArmMat(rogue: boolean): THREE.MeshStandardMaterial {
  if (rogue) {
    if (!materialPool.armRogue) materialPool.armRogue = new THREE.MeshStandardMaterial({ color: 0x331111, metalness: 0.9, roughness: 0.4 })
    return materialPool.armRogue
  }
  if (!materialPool.arm) materialPool.arm = new THREE.MeshStandardMaterial({ color: 0x445566, metalness: 0.8, roughness: 0.4 })
  return materialPool.arm
}
function getMotorMat(): THREE.MeshStandardMaterial {
  if (!materialPool.motor) materialPool.motor = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.95, roughness: 0.15 })
  return materialPool.motor
}
function getPropMat(color: number): THREE.MeshBasicMaterial {
  if (!materialPool.prop.has(color)) {
    materialPool.prop.set(color, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
    }))
  }
  return materialPool.prop.get(color)!
}
function getPropBlurMat(color: number): THREE.MeshBasicMaterial {
  if (!materialPool.propBlur.has(color)) {
    materialPool.propBlur.set(color, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.06, side: THREE.DoubleSide,
    }))
  }
  return materialPool.propBlur.get(color)!
}
function getGlowSpriteMat(color: number): THREE.SpriteMaterial {
  if (!materialPool.glowSprite.has(color)) {
    materialPool.glowSprite.set(color, new THREE.SpriteMaterial({
      map: getGlowTexture(), color, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }))
  }
  return materialPool.glowSprite.get(color)!
}
function getAuraMat(color: number): THREE.MeshBasicMaterial {
  if (!materialPool.aura.has(color)) {
    materialPool.aura.set(color, new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide, transparent: true, opacity: 0.08,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }))
  }
  return materialPool.aura.get(color)!
}
function getShieldMat(color: number): THREE.MeshBasicMaterial {
  if (!materialPool.shield.has(color)) {
    materialPool.shield.set(color, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.0, wireframe: true,
      blending: THREE.AdditiveBlending,
    }))
  }
  return materialPool.shield.get(color)!
}
function getRogueHullMat(): THREE.MeshBasicMaterial {
  if (!materialPool.rogueHull) {
    materialPool.rogueHull = new THREE.MeshBasicMaterial({
      color: 0xff0000, transparent: true, opacity: 0.06,
      wireframe: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
  }
  return materialPool.rogueHull
}
function getRogueBodyMat(): THREE.MeshPhysicalMaterial {
  if (!materialPool.rogueBody) {
    materialPool.rogueBody = new THREE.MeshPhysicalMaterial({
      color: 0x880000, emissive: 0xff3b3b, emissiveIntensity: 0.8,
      roughness: 0.3, metalness: 0.9, clearcoat: 0.5,
    })
  }
  return materialPool.rogueBody
}

// ═══════════════════════════════════════════════════════
// 共享几何体 — 全局创建一次
// ═══════════════════════════════════════════════════════
const sharedGeo = {
  normalBody: null as THREE.BufferGeometry | null,
  rogueBody: null as THREE.BufferGeometry | null,
  normalArm: null as THREE.BufferGeometry | null,
  rogueArm: null as THREE.BufferGeometry | null,
  normalMotor: null as THREE.BufferGeometry | null,
  rogueMotor: null as THREE.BufferGeometry | null,
  propBlade: null as THREE.BufferGeometry | null,
  propBladeRogue: null as THREE.BufferGeometry | null,
  propBlur: null as THREE.BufferGeometry | null,
  propBlurRogue: null as THREE.BufferGeometry | null,
  aura: null as THREE.BufferGeometry | null,
  shield: null as THREE.BufferGeometry | null,
  rogueHull: null as THREE.BufferGeometry | null,
  landingStrut: null as THREE.BufferGeometry | null,
  landingSkid: null as THREE.BufferGeometry | null,
  ledSphere: null as THREE.BufferGeometry | null,
}

function initSharedGeo() {
  // 正常机: 扁平圆角方体 (宽3, 高0.9, 深3) — 用 BoxGeometry 近似
  const nb = new THREE.BoxGeometry(3.0, 0.9, 3.0, 3, 1, 3)
  // 简单圆角：缩放顶点距离中心较远的角落
  roundBoxVertices(nb, 0.35)
  sharedGeo.normalBody = nb

  // 黑飞机: 比例放大 1.2x
  const rb = new THREE.BoxGeometry(3.6, 1.08, 3.6, 3, 1, 3)
  roundBoxVertices(rb, 0.4)
  sharedGeo.rogueBody = rb

  // 机臂: 扁平方管 (宽0.35, 高0.2, 长=臂长)
  sharedGeo.normalArm = new THREE.BoxGeometry(0.30, 0.18, 2.5)
  sharedGeo.rogueArm = new THREE.BoxGeometry(0.36, 0.22, 3.0)

  // 电机座: 圆柱
  sharedGeo.normalMotor = new THREE.CylinderGeometry(0.28, 0.28, 0.55, 12)
  sharedGeo.rogueMotor = new THREE.CylinderGeometry(0.34, 0.34, 0.65, 12)

  // 桨叶: 两片细长矩形
  sharedGeo.propBlade = new THREE.BoxGeometry(0.12, 0.04, 1.6)
  sharedGeo.propBladeRogue = new THREE.BoxGeometry(0.14, 0.05, 1.9)

  // 高速旋转模糊圆盘
  sharedGeo.propBlur = new THREE.CircleGeometry(0.9, 16)
  sharedGeo.propBlurRogue = new THREE.CircleGeometry(1.05, 16)

  // 频道光环
  sharedGeo.aura = new THREE.RingGeometry(2, 3, 32)

  // 功率护盾
  sharedGeo.shield = new THREE.SphereGeometry(2.5, 16, 16)

  // 黑飞外壳
  sharedGeo.rogueHull = new THREE.OctahedronGeometry(3.5, 0)

  // 起落架: 支柱 + 横杆
  sharedGeo.landingStrut = new THREE.BoxGeometry(0.08, 1.2, 0.08)
  sharedGeo.landingSkid = new THREE.BoxGeometry(0.08, 0.08, 1.8)

  // LED 灯球
  sharedGeo.ledSphere = new THREE.SphereGeometry(0.12, 8, 8)
}

/** 对 BoxGeometry 顶点做简单圆角处理 */
function roundBoxVertices(geo: THREE.BoxGeometry, radius: number) {
  const pos = geo.attributes.position
  const hw = (geo.parameters.width / 2)
  const hh = (geo.parameters.height / 2)
  const hd = (geo.parameters.depth / 2)
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    // 将每个角落的顶点向内插值
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z)
    const fx = Math.max(0, (ax - (hw - radius)) / radius)
    const fy = Math.max(0, (ay - (hh - radius)) / radius)
    const fz = Math.max(0, (az - (hd - radius)) / radius)
    const cornerDist = Math.sqrt(fx * fx + fy * fy + fz * fz)
    if (cornerDist > 1) {
      const scale = 1 / cornerDist
      if (fx > 0) x = Math.sign(x) * ((hw - radius) + fx * scale * radius)
      if (fy > 0) y = Math.sign(y) * ((hh - radius) + fy * scale * radius)
      if (fz > 0) z = Math.sign(z) * ((hd - radius) + fz * scale * radius)
      pos.setXYZ(i, x, y, z)
    }
  }
  geo.computeVertexNormals()
}

// ═══════════════════════════════════════════════════════
// 统一基础构建函数
// ═══════════════════════════════════════════════════════
interface UAVBuildConfig {
  bodyGeo: THREE.BufferGeometry
  bodyMat: THREE.MeshPhysicalMaterial
  armGeo: THREE.BufferGeometry
  armMat: THREE.MeshStandardMaterial
  motorGeo: THREE.BufferGeometry
  bladeGeo: THREE.BufferGeometry
  blurGeo: THREE.BufferGeometry
  propColor: number
  glowColor: number
  armReach: number   // 机臂末端到中心的距离
  isRogue: boolean
}

function buildUAVBase(uav: UAVNode, cfg: UAVBuildConfig): THREE.Group {
  const group = new THREE.Group()
  const ud: UAVMeshUserData = {
    uavId: uav.id,
    isRogue: cfg.isRogue,
    yaw: 0,
    channelAura: null,
    powerShield: null,
    hull: null,
    glowSprite: null,
    propellers: [],
    motorBlurDiscs: [],
  }

  // ── 机身 ──
  const body = new THREE.Mesh(cfg.bodyGeo, cfg.bodyMat)
  body.castShadow = true
  group.add(body)

  // ── 4 根机臂 + 电机座 + 桨叶 ──
  const armHalfLen = (cfg.armGeo as THREE.BoxGeometry).parameters.depth / 2
  const bodyHalfW = (cfg.bodyGeo as THREE.BoxGeometry).parameters.width / 2 * 0.7 // 从机身边缘开始

  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4 // 45°, 135°, 225°, 315° — X 形布局
    const cosA = Math.cos(angle)
    const sinA = Math.sin(angle)

    // 机臂中心位置: 机身表面到臂末端的中点
    const armCenterDist = bodyHalfW + armHalfLen
    const armPivot = new THREE.Group()
    armPivot.rotation.y = angle
    const arm = new THREE.Mesh(cfg.armGeo, cfg.armMat)
    arm.position.set(0, 0, armCenterDist)
    armPivot.add(arm)
    group.add(armPivot)

    // 电机座 — 在机臂末端
    const motor = new THREE.Mesh(cfg.motorGeo, getMotorMat())
    motor.position.set(cosA * cfg.armReach, 0.35, sinA * cfg.armReach)
    group.add(motor)

    // 桨叶组（2 片十字排列）
    const bladeGroup = new THREE.Group()
    bladeGroup.position.set(cosA * cfg.armReach, 0.7, sinA * cfg.armReach)

    const blade1 = new THREE.Mesh(cfg.bladeGeo, getPropMat(cfg.propColor))
    const blade2 = new THREE.Mesh(cfg.bladeGeo, getPropMat(cfg.propColor))
    blade2.rotation.y = Math.PI / 2
    bladeGroup.add(blade1)
    bladeGroup.add(blade2)

    // 高速旋转模糊圆盘
    const blur = new THREE.Mesh(cfg.blurGeo, getPropBlurMat(cfg.propColor))
    blur.rotation.x = -Math.PI / 2
    bladeGroup.add(blur)

    group.add(bladeGroup)
    ud.propellers.push(bladeGroup)
    ud.motorBlurDiscs.push(blur)
  }

  // ── 发光 Sprite（替代 PointLight）──
  const glowSprite = new THREE.Sprite(getGlowSpriteMat(cfg.glowColor))
  glowSprite.position.set(0, -0.5, 0)
  glowSprite.scale.set(4, 4, 1)
  group.add(glowSprite)
  ud.glowSprite = glowSprite

  // ── 起落架 ──
  const strutMat = getArmMat(false)  // 复用金属灰色
  const geoS = sharedGeo.landingStrut!
  const geoK = sharedGeo.landingSkid!
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(geoS, strutMat)
    strut.position.set(side * 0.9, -1.05, 0)
    group.add(strut)
    const skid = new THREE.Mesh(geoK, strutMat)
    skid.position.set(side * 0.9, -1.65, 0)
    group.add(skid)
  }

  // ── LED 方向灯 ──
  const ledGeo = sharedGeo.ledSphere!
  const ledFront = new THREE.Mesh(ledGeo, new THREE.MeshBasicMaterial({ color: 0x00ff44 }))
  ledFront.position.set(0, 0, 1.3)
  group.add(ledFront)
  const ledBack = new THREE.Mesh(ledGeo, new THREE.MeshBasicMaterial({ color: 0xff0000 }))
  ledBack.position.set(0, 0, -1.3)
  group.add(ledBack)

  // ── ID 标签 ──
  const labelColor = cfg.isRogue ? '#ef4444' : (channelHexStr[uav.channel] || '#23d7e6')
  const idLabel = createTextSprite(`${uav.id}`, labelColor)
  idLabel.position.set(0, 3.5, 0)
  idLabel.scale.set(5, 2.5, 1)
  group.add(idLabel)

  Object.assign(group.userData, ud)
  return group
}

/** 黑飞无人机 */
function createRogueUAVMesh(uav: UAVNode): THREE.Group {
  const group = buildUAVBase(uav, {
    bodyGeo: sharedGeo.rogueBody!,
    bodyMat: getRogueBodyMat(),
    armGeo: sharedGeo.rogueArm!,
    armMat: getArmMat(true),
    motorGeo: sharedGeo.rogueMotor!,
    bladeGeo: sharedGeo.propBladeRogue!,
    blurGeo: sharedGeo.propBlurRogue!,
    propColor: 0xff0000,
    glowColor: 0xff3b3b,
    armReach: 3.55,
    isRogue: true,
  })

  // 黑飞独有：红色线框外壳
  const hull = new THREE.Mesh(sharedGeo.rogueHull!, getRogueHullMat().clone())
  group.add(hull)
  ;(group.userData as UAVMeshUserData).hull = hull

  return group
}

/** 正常编队无人机 */
function createUAVMesh(uav: UAVNode): THREE.Group {
  const color = channelColors[uav.channel] || 0x00f2ff

  const group = buildUAVBase(uav, {
    bodyGeo: sharedGeo.normalBody!,
    bodyMat: getBodyMat(color),
    armGeo: sharedGeo.normalArm!,
    armMat: getArmMat(false),
    motorGeo: sharedGeo.normalMotor!,
    bladeGeo: sharedGeo.propBlade!,
    blurGeo: sharedGeo.propBlur!,
    propColor: color,
    glowColor: color,
    armReach: 3.0,
    isRogue: false,
  })

  // 正常机独有：频道光环
  const channelAura = new THREE.Mesh(sharedGeo.aura!, getAuraMat(color).clone())
  channelAura.rotation.x = -Math.PI / 2
  channelAura.position.y = -0.8
  group.add(channelAura)
  ;(group.userData as UAVMeshUserData).channelAura = channelAura

  // 正常机独有：功率护盾
  const powerShield = new THREE.Mesh(sharedGeo.shield!, getShieldMat(color).clone())
  group.add(powerShield)
  ;(group.userData as UAVMeshUserData).powerShield = powerShield

  return group
}

function updateUAVs() {
  if (!frame.value || !frame.value.uav_nodes) {
    uavMeshes.forEach(m => m.visible = false)
    trailLines.forEach(l => l.visible = false)
    return
  }
  const uavs: UAVNode[] = frame.value.uav_nodes
  const time = clock.getElapsedTime()

  const currentIds = new Set(uavs.map(u => u.id))

  for (const uav of uavs) {
    // Interpolate positions
    const prev = interpPositions.get(uav.id)
    let targetX = uav.x
    let targetZ = uav.y
    let targetY = uav.z !== undefined ? uav.z : (30 + uav.id * 3)

    // APPLY GeoJSON TRANSFORM IF ACTIVE
    if (sceneMode.value === 'geojson' && geojsonMapData.value) {
      targetX = targetX * geojsonTransform.scale + geojsonTransform.offsetX
      // Invert Z for map display: (MapHeight - Y) * Scale
      targetZ = (geojsonMapData.value.map_height - targetZ) * geojsonTransform.scale + geojsonTransform.offsetZ
      targetY = targetY * geojsonTransform.scale
    }

    if (prev) {
      interpPositions.set(uav.id, {
        x: prev.x + (targetX - prev.x) * 0.08,
        y: prev.y + (targetY - prev.y) * 0.08,
        z: prev.z + (targetZ - prev.z) * 0.08,
      })
    } else {
      interpPositions.set(uav.id, { x: targetX, y: targetY, z: targetZ })
    }

    const pos = interpPositions.get(uav.id)!
    let mesh = uavMeshes.get(uav.id)

    if (!mesh) {
      mesh = (uav.node_type === 1 || uav.id >= 1000)
        ? createRogueUAVMesh(uav)
        : createUAVMesh(uav)
      uavMeshes.set(uav.id, mesh)
      scene.add(mesh)
    }

    mesh.position.set(pos.x, pos.y, pos.z)
    mesh.visible = true

    // Dynamic Scale
    const scaleFactor = Math.max(1, cameraDistance / 200)
    mesh.scale.setScalar(scaleFactor)
    
    // Conflict drift removed per request
    if (uav.is_conflict) {
      // mesh.position.x += Math.sin(time * 15) * 1.5
      // mesh.position.z += Math.cos(time * 18) * 1.5
    }

    const ud = mesh.userData as UAVMeshUserData

    // ── 螺旋桨旋转动画 ──
    for (const bladeGroup of ud.propellers) {
      bladeGroup.rotation.y = time * 18 + uav.id * 0.5
    }

    // ── 黑飞节点动画 ──
    if (ud.isRogue) {
      // 机身发酵脉冲移除，固定为普通红色
      const body = mesh.children[0] as THREE.Mesh
      if (body?.material) {
        // Reset or keep static intensity
        ;(body.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.2
      }
      // 外壳缓慢旋转 + 呼吸缩放
      if (ud.hull) {
        const hull = ud.hull as THREE.Mesh
        hull.rotation.y = time * 0.15 // ~8.6°/s
        hull.rotation.x = time * 0.08
        const breathScale = 1.0 + Math.sin(time * Math.PI) * 0.05 // 0.95~1.05, 周期2秒
        hull.scale.setScalar(breathScale)
        ;(hull.material as THREE.MeshBasicMaterial).opacity = 0.04 + Math.abs(Math.sin(time * 4)) * 0.06
      }
      // 移除光晕 Sprite 或减弱
      if (ud.glowSprite) {
        // User requested no intense glow
        ud.glowSprite.visible = false
      }
      // 移除漂移
    } else {
      // ── 正常机动画 ──
      
      // 1. 频道光环 (已按需移除显示)
      if (ud.channelAura) {
        (ud.channelAura as THREE.Mesh).visible = false
      }

      // 2. 红色球体：仅用于显示同频冲突
      // 替代原有的功率护盾逻辑，不再显示功率状态
      if (ud.powerShield) {
        const shield = ud.powerShield as THREE.Mesh
        const shMat = shield.material as THREE.MeshBasicMaterial
        
        if (uav.is_conflict) {
          // 冲突报警：红色呼吸球体
          shMat.color.setHex(0xff3b3b) 
          shMat.opacity = 0.4 + Math.sin(time * 12) * 0.15
          shield.scale.setScalar(1.2 + Math.sin(time * 12) * 0.05)
          shield.visible = true
        } else {
          // 正常：完全隐藏
          shield.visible = false
        }
      }
    }

    // Dynamic Orientation based on velocity
    if (prev) {
      const vx = uav.x - prev.x
      const vz = uav.y - prev.z
      const speed = Math.sqrt(vx * vx + vz * vz)

      if (speed > 0.05) {
        mesh.rotation.order = 'YXZ'
        let targetYaw = Math.atan2(vx, vz)
        let currYaw = ud.yaw || 0
        let diff = targetYaw - currYaw
        while (diff > Math.PI) diff -= Math.PI * 2
        while (diff < -Math.PI) diff += Math.PI * 2

        currYaw += diff * 0.1
        ud.yaw = currYaw
        mesh.rotation.y = currYaw

        const turnRate = diff * 0.1
        const targetRoll = -turnRate * 12
        const targetPitch = Math.min(speed * 0.05, 0.4)
        mesh.rotation.x += (targetPitch - mesh.rotation.x) * 0.1
        mesh.rotation.z += (targetRoll - mesh.rotation.z) * 0.1
      } else {
        mesh.rotation.z += (Math.sin(time + uav.id) * 0.05 - mesh.rotation.z) * 0.1
        mesh.rotation.x += (Math.cos(time * 0.7 + uav.id) * 0.03 - mesh.rotation.x) * 0.1
      }
    } else {
      mesh.rotation.z = Math.sin(time + uav.id) * 0.05
      mesh.rotation.x = Math.cos(time * 0.7 + uav.id) * 0.03
    }

    // Update Flight Trails
    if (!uavTrails.has(uav.id)) {
      // Initialize with fixed-size array of existing vectors to avoid GC
      const initialTrail = new Array(25).fill(null).map(() => new THREE.Vector3(pos.x, pos.y, pos.z))
      uavTrails.set(uav.id, initialTrail)
    }
    const trail = uavTrails.get(uav.id)!
    // Move every point back by 1 (manual shift) instead of array.shift/push
    for (let i = 0; i < trail.length - 1; i++) {
      trail[i].copy(trail[i + 1])
    }
    // Update the latest point
    trail[trail.length - 1].set(pos.x, pos.y, pos.z)

    let line = trailLines.get(uav.id)
    if (!line) {
      const geo = new THREE.BufferGeometry()
      const posArr = new Float32Array(25 * 3)
      geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3))
      const mat = new THREE.LineBasicMaterial({
        color: channelHexStr[uav.channel] || 0x00f2ff,
        transparent: true, opacity: 0.6,
      })
      line = new THREE.Line(geo, mat)
      trailLines.set(uav.id, line)
      trailGroup.add(line)
    }

    const posAttr = line.geometry.attributes.position
    const arr = posAttr.array as Float32Array
    for (let i = 0; i < trail.length; i++) {
      arr[i * 3] = trail[i].x
      arr[i * 3 + 1] = trail[i].y
      arr[i * 3 + 2] = trail[i].z
    }
    line.geometry.setDrawRange(0, trail.length)
    posAttr.needsUpdate = true
    line.visible = true
  }
  
  for (const [id, mesh] of uavMeshes.entries()) {
    if (!currentIds.has(id)) {
      // 从场景中移除
      scene.remove(mesh)
      // 递归释放几何体和材质
      mesh.traverse((child: any) => {
        if (child.geometry) child.geometry.dispose()
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m: any) => m.dispose())
          } else {
            child.material.dispose()
          }
        }
      })
      uavMeshes.delete(id)
      // 同时清理插值位置
      interpPositions.delete(id)
    }
  }

  // Cleanup old trails
  for (const [id, line] of trailLines.entries()) {
    if (!uavs.some(u => u.id === id)) {
      trailGroup.remove(line)
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
      trailLines.delete(id)
      uavTrails.delete(id)
    }
  }
}

function updateLinks() {
  if (!frame.value || !frame.value.uav_nodes || !linkSegmentsMesh || !flowPointsMesh) {
    if (linkSegmentsMesh) linkSegmentsMesh.visible = false
    if (flowPointsMesh) flowPointsMesh.visible = false
    return
  }
  linkSegmentsMesh.visible = true
  flowPointsMesh.visible = true
  const uavs: UAVNode[] = frame.value.uav_nodes
  const time = clock.getElapsedTime()
  const selId = selectedUAVId?.value?.id ?? null

  const currentLinkIds = new Set<string>()
  const connectedPairs: [UAVNode, UAVNode][] = []

  // 1. 解析拓扑
  const uavMap = new Map<number, UAVNode>()
  uavs.forEach(u => uavMap.set(u.id, u))
  const isRogue = (u: UAVNode) => (u.node_type === 1 || u.id >= 1000)

  if (frame.value.links && frame.value.links.length > 0) {
    for (let i = 0; i < frame.value.links.length; i++) {
      const linkStr = frame.value.links[i]
      const matches = linkStr.match(/\d+/g)
      if (matches && matches.length >= 2) {
        const idA = parseInt(matches[0])
        const idB = parseInt(matches[1])
        const a = uavMap.get(idA)
        const b = uavMap.get(idB)
        if (a && b) {
          if (isRogue(a) && isRogue(b)) continue
          connectedPairs.push([a, b])
          const linkId = idA < idB ? `${idA}-${idB}` : `${idB}-${idA}`
          currentLinkIds.add(linkId)
        }
      }
    }
  } else {
    for (let i = 0; i < uavs.length; i++) {
      for (let j = i + 1; j < uavs.length; j++) {
        const a = uavs[i], b = uavs[j]
        if (isRogue(a) && isRogue(b)) continue
        if (Math.hypot(a.x - b.x, a.y - b.y) <= 120) {
          connectedPairs.push([a, b])
          const linkId = `${a.id}-${b.id}`
          currentLinkIds.add(linkId)
        }
      }
    }
  }

  // 2. 断裂火花
  for (const prevLink of previousFrameLinks) {
    if (!currentLinkIds.has(prevLink)) {
      const parts = prevLink.split('-')
      const posA = interpPositions.get(parseInt(parts[0]))
      const posB = interpPositions.get(parseInt(parts[1]))
      if (posA && posB) createBrokenSpark(posA, posB)
    }
  }
  previousFrameLinks = currentLinkIds

  // ═══ 3. 每帧 NLOS 缓存（避免对每条链路重复遍历建筑列表） ═══
  const nlosCache = new Map<number, boolean>()
  function isNLOS(u: UAVNode): boolean {
    if (nlosCache.has(u.id)) return nlosCache.get(u.id)!
    const result = checkNLOSDynamic(u.x, u.y, u.z)
    nlosCache.set(u.id, result)
    return result
  }

  // ═══ 4. 直接写入预分配缓冲区，不再 new / slice ═══
  const colorTmp = new THREE.Color()  // 复用
  let linkCount = 0
  let flowCount = 0

  for (let i = 0; i < connectedPairs.length; i++) {
    if (linkCount >= MAX_LINKS) break        // 安全上限
    const [a, b] = connectedPairs[i]
    const posA = interpPositions.get(a.id) || { x: a.x, y: a.z !== undefined ? a.z : 40, z: a.y }
    const posB = interpPositions.get(b.id) || { x: b.x, y: b.z !== undefined ? b.z : 40, z: b.y }

    let baseColor = 0x00f2ff
    let opacity = 0.15

    if (currentAppMode.value === 'non_cooperative') {
        // 非合作场景下表现“概率推断连接”
        // 这里基于距离等伪造一个 0~1 的置信度
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const prob = Math.max(0.1, 1 - (dist / 150)) // 距离越近置信度越高

        if (prob > 0.6) {
          baseColor = 0xfacc15 // 亮黄代表高确信度
          opacity = 0.6 * prob
        } else {
          baseColor = 0xffe270 // 偏白淡黄代表低确信度推测
          opacity = 0.15 * prob
        }
        
        // 如果是正受攻击的节点（用 conflict 状态借用做被攻击）
        if (a.is_conflict || b.is_conflict) {
          baseColor = 0xff3b3b
          opacity = 0.8 + Math.sin(time * 15) * 0.2 // 快红爆裂脉冲
        }

    } else {
      // 合作场景下的常规通信判断
      if (a.is_conflict || b.is_conflict) {
        baseColor = 0xff3b3b
        opacity = 0.4 + Math.sin(time * 10) * 0.3
      } else if (isNLOS(a) || isNLOS(b)) {       
        baseColor = 0xffaa00
        opacity = 0.3
      }
    }

    if (selId !== null) {
      if (a.id === selId || b.id === selId) opacity = Math.min(opacity * 2.5, 0.9)
      else opacity *= 0.15
    }

    colorTmp.setHex(baseColor)

    const pIdx = linkCount * 6
    const cIdx = linkCount * 8
    linkPosBuffer[pIdx]     = posA.x; linkPosBuffer[pIdx + 1] = posA.y; linkPosBuffer[pIdx + 2] = posA.z
    linkPosBuffer[pIdx + 3] = posB.x; linkPosBuffer[pIdx + 4] = posB.y; linkPosBuffer[pIdx + 5] = posB.z
    linkColBuffer[cIdx]     = colorTmp.r; linkColBuffer[cIdx + 1] = colorTmp.g; linkColBuffer[cIdx + 2] = colorTmp.b; linkColBuffer[cIdx + 3] = opacity
    linkColBuffer[cIdx + 4] = colorTmp.r; linkColBuffer[cIdx + 5] = colorTmp.g; linkColBuffer[cIdx + 6] = colorTmp.b; linkColBuffer[cIdx + 7] = opacity
    linkCount++

    // 流动点
    if (opacity > 0.05 && flowCount + 3 <= MAX_FLOW) {
      const dir = b.id > a.id ? 1 : -1
      const speed = (a.is_conflict || b.is_conflict) ? 0.5 : 2.5
      for (let k = 0; k < 3; k++) {
        const t = (time * speed + k * 0.33) % 1.0
        const actualT = dir === 1 ? t : 1 - t
        const fpIdx = flowCount * 3
        const fcIdx = flowCount * 4
        flowPosBuffer[fpIdx]     = posA.x + (posB.x - posA.x) * actualT
        flowPosBuffer[fpIdx + 1] = posA.y + (posB.y - posA.y) * actualT
        flowPosBuffer[fpIdx + 2] = posA.z + (posB.z - posA.z) * actualT
        flowColBuffer[fcIdx]     = colorTmp.r; flowColBuffer[fcIdx + 1] = colorTmp.g; flowColBuffer[fcIdx + 2] = colorTmp.b; flowColBuffer[fcIdx + 3] = opacity * 1.5
        flowCount++
      }
    }
  }

  // ═══ 5. 更新 GPU 缓冲区（零分配） ═══
  const linkGeo = linkSegmentsMesh.geometry
  const needsRebuildLink = !linkGeo.attributes.position || (linkGeo.attributes.position as THREE.BufferAttribute).array.length < MAX_LINKS * 6

  if (needsRebuildLink) {
    // 首次或容量不够时才分配（整个生命周期最多 1~2 次）
    linkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_LINKS * 6), 3))
    linkGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_LINKS * 8), 4))
  }

  const lpa = linkGeo.attributes.position.array as Float32Array
  const lca = linkGeo.attributes.color.array as Float32Array
  lpa.set(linkPosBuffer.subarray(0, linkCount * 6))   // subarray 不分配内存！
  lca.set(linkColBuffer.subarray(0, linkCount * 8))
  linkGeo.attributes.position.needsUpdate = true
  linkGeo.attributes.color.needsUpdate = true
  linkGeo.setDrawRange(0, linkCount * 2)

  const fGeo = flowPointsMesh.geometry
  const needsRebuildFlow = !fGeo.attributes.position || (fGeo.attributes.position as THREE.BufferAttribute).array.length < MAX_FLOW * 3

  if (needsRebuildFlow) {
    fGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_FLOW * 3), 3))
    fGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_FLOW * 4), 4))
  }

  const fpa = fGeo.attributes.position.array as Float32Array
  const fca = fGeo.attributes.color.array as Float32Array
  fpa.set(flowPosBuffer.subarray(0, flowCount * 3))
  fca.set(flowColBuffer.subarray(0, flowCount * 4))
  fGeo.attributes.position.needsUpdate = true
  fGeo.attributes.color.needsUpdate = true
  fGeo.setDrawRange(0, flowCount)
}

function createBrokenSpark(posA: {x:number, y:number, z:number}, posB: {x:number, y:number, z:number}) {
  const cx = (posA.x + posB.x) / 2
  const cy = (posA.y + posB.y) / 2
  const cz = (posA.z + posB.z) / 2

  const grp = new THREE.Group()
  grp.position.set(cx, cy, cz)

  // 用 Sprite 模拟闪光，比 PointLight 便宜得多
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color: 0xff3b3b,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }))
  sprite.scale.set(12, 12, 1)
  grp.add(sprite)

  if (brokenLinksGroup) {
    brokenLinksGroup.add(grp)
    brokenLinkParticles.push({ obj: grp, timeRemaining: 1.0 })
  }
}

function updateBrokenSparks(delta: number) {
  if (!brokenLinksGroup) return
  for (let i = brokenLinkParticles.length - 1; i >= 0; i--) {
    const p = brokenLinkParticles[i]
    p.timeRemaining -= delta

    // Sprite 闪烁
    const sprite = p.obj.children[0] as THREE.Sprite
    if (sprite?.material) {
      (sprite.material as THREE.SpriteMaterial).opacity = 
        Math.max(0, p.timeRemaining * (0.3 + Math.random() * 0.7))
      const s = 8 + Math.random() * 8
      sprite.scale.set(s, s, 1)
    }

    if (p.timeRemaining <= 0) {
      brokenLinksGroup.remove(p.obj)
      // dispose sprite material
      const mat = (p.obj.children[0] as THREE.Sprite)?.material as THREE.SpriteMaterial
      mat?.dispose()
      brokenLinkParticles.splice(i, 1)
    }
  }
}

// Camera controls
function updateCameraPosition() {
  camera.position.set(
    cameraTarget.x + cameraDistance * Math.sin(cameraAngle.phi) * Math.cos(cameraAngle.theta),
    cameraTarget.y + cameraDistance * Math.cos(cameraAngle.phi),
    cameraTarget.z + cameraDistance * Math.sin(cameraAngle.phi) * Math.sin(cameraAngle.theta),
  )
  camera.lookAt(cameraTarget)
}

function toRenderPosition(uav: UAVNode) {
  let x = Number(uav.x ?? 0)
  let z = Number(uav.y ?? 0)
  let y = Number(uav.z ?? 30)

  if (sceneMode.value === 'geojson' && geojsonMapData.value) {
    x = x * geojsonTransform.scale + geojsonTransform.offsetX
    z = (geojsonMapData.value.map_height - z) * geojsonTransform.scale + geojsonTransform.offsetZ
    y = y * geojsonTransform.scale
  }

  return { x, y, z }
}

function autoFocusOnUavs(uavs: UAVNode[]) {
  const visibleUavs = uavs.filter((uav) => uav.node_type !== 1)
  if (visibleUavs.length === 0) return

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  for (const uav of visibleUavs) {
    const pos = toRenderPosition(uav)
    minX = Math.min(minX, pos.x)
    maxX = Math.max(maxX, pos.x)
    minY = Math.min(minY, pos.y)
    maxY = Math.max(maxY, pos.y)
    minZ = Math.min(minZ, pos.z)
    maxZ = Math.max(maxZ, pos.z)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    return
  }

  cameraTarget.set(
    (minX + maxX) / 2,
    Math.max(0, (minY + maxY) / 2),
    (minZ + maxZ) / 2,
  )

  const spanX = maxX - minX
  const spanZ = maxZ - minZ
  const dominantSpan = Math.max(spanX, spanZ, 120)
  cameraDistance = Math.max(180, Math.min(1200, dominantSpan * 1.8))
  updateCameraPosition()
}

function onMouseDown(e: MouseEvent) {
  isDragging = true
  shouldAutoFocusOnNextDataset = false
  prevMouse = { x: e.clientX, y: e.clientY }
  renderer.domElement.style.cursor = 'grabbing'
}

function onMouseMove(e: MouseEvent) {
  if (isDragging) {
    hoverInfo.value.show = false
    const dx = e.clientX - prevMouse.x
    const dy = e.clientY - prevMouse.y
    prevMouse = { x: e.clientX, y: e.clientY }

    if (e.shiftKey || e.buttons === 4 || e.buttons === 2) {
      // Shift / 中键 / 右键：旋转视角（Orbit）
      cameraAngle.theta += dx * 0.005
      cameraAngle.phi = Math.max(0.1, Math.min(Math.PI * 0.48, cameraAngle.phi - dy * 0.005))
    } else {
      // 左键拖拽：地面平移（Pan）
      camera.getWorldDirection(_panFwd)
      _panFwd.y = 0
      _panFwd.normalize()
      _panRight.crossVectors(_panFwd, new THREE.Vector3(0, 1, 0)).normalize()
      const panSpeed = cameraDistance * 0.0018
      cameraTarget.addScaledVector(_panRight, -dx * panSpeed)
      cameraTarget.addScaledVector(_panFwd, dy * panSpeed)
    }
    updateCameraPosition()
    return
  }

  if (!renderer) return
  const rendererDom = renderer.domElement

  if (selectedUAVId?.value) {
    hoverInfo.value.show = false
    return
  }

  // Picker mode cursor
  if (interactionState.mode !== 'none') {
    rendererDom.style.cursor = 'crosshair'
    hoverInfo.value.show = false
    return
  }

  // Hover detection for tooltip
  const now = performance.now()
  if (now - hoverThrottleTimer < HOVER_THROTTLE_MS) return
  hoverThrottleTimer = now

  if (!frame.value) return
  const rect = renderer.domElement.getBoundingClientRect()
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(mouse, camera)
  const meshes = Array.from(uavMeshes.values())
  const intersects = raycaster.intersectObjects(meshes, true)

  hoverInfo.value.show = false

  if (intersects.length > 0) {
    let obj: THREE.Object3D | null = intersects[0].object
    while (obj && obj.userData.uavId === undefined) obj = obj.parent
    if (obj && obj.userData.uavId !== undefined) {
      const uav = frame.value.uav_nodes.find((u: UAVNode) => u.id === obj!.userData.uavId)
      if (uav) {
        hoverInfo.value = { show: true, x: e.clientX, y: e.clientY, uav }
        renderer.domElement.style.cursor = 'pointer'
        return
      }
    }
  }
  hoverInfo.value.show = false
  renderer.domElement.style.cursor = 'grab'
}

function onMouseUp() {
  isDragging = false
  renderer.domElement.style.cursor = 'grab'
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  cameraDistance = Math.max(100, Math.min(1200, cameraDistance + e.deltaY * 0.5))
  updateCameraPosition()
}

function onClick(e: MouseEvent) {
  if (!renderer) return
  const rect = renderer.domElement.getBoundingClientRect()
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(mouse, camera)

  // Handled waypoint picker mode
  if (interactionState.mode === 'setStart' || interactionState.mode === 'setTarget') {
    const intersects = raycaster.intersectObjects(scene.children, true)
    // Find ground plane
    let pt: THREE.Vector3 | null = null
    for (const hit of intersects) {
      if (hit.object.userData.isGround) {
        pt = hit.point
        break
      }
    }
    
    if (pt) {
      // Inverse Transform for OSM mode
      let worldX = pt.x
      let worldZ = pt.z

      if (sceneMode.value === 'geojson' && geojsonTransform.scale > 0 && geojsonMapData.value) {
        // (RenderX - OffsetX) / Scale = OriginalX
        // For Z: MapHeight - ((RenderZ - OffsetZ) / Scale) = OriginalY (Inverted Y for North-Up)
        worldX = (worldX - geojsonTransform.offsetX) / geojsonTransform.scale
        worldZ = geojsonMapData.value.map_height - (worldZ - geojsonTransform.offsetZ) / geojsonTransform.scale

        worldX = Math.max(0, Math.min(geojsonMapData.value.map_width, worldX))
        worldZ = Math.max(0, Math.min(geojsonMapData.value.map_height, worldZ))
      }
      
      const coords = `${Math.round(worldX)},${Math.round(worldZ)},30`
      if (interactionState.mode === 'setStart') {
        missionWaypoints.start = coords
      } else {
        missionWaypoints.target = coords
      }
      interactionState.mode = 'none'
      renderer.domElement.style.cursor = 'grab'
      updateWaypointMarkers()
      return
    }
  }

  // UAV Selection Logic
  const meshes = Array.from(uavMeshes.values())
  const uavIntersects = raycaster.intersectObjects(meshes, true)

  if (uavIntersects.length > 0) {
    let obj: THREE.Object3D | null = uavIntersects[0].object
    // Walk up to find the group with uavId
    while (obj && obj.userData.uavId === undefined && obj.parent) {
      obj = obj.parent
    }
    if (obj && obj.userData.uavId !== undefined && frame.value) {
      const uav = frame.value.uav_nodes.find((u: UAVNode) => u.id === obj!.userData.uavId)
      if (uav) {
        emit('select-uav', uav)
        return
      }
    }
  }
  emit('select-uav', null)
}

function animate() {
  animId = requestAnimationFrame(animate)
  const delta = clock.getDelta()         // 先取 delta
  const time = clock.getElapsedTime()    // 再取累计时间
  updateUAVs()
  try { updateLinks() } catch (e) { console.warn('[WingNet] link error:', e) }
  try { updateBrokenSparks(delta) } catch (e) { /* silent */ }

  // Animate environment particles (gentle float)
  envParticleFrameSkip++
  if (envParticles && envParticleFrameSkip % 3 === 0) {
    const pos = envParticles.geometry.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    for (let i = 0; i < pos.count; i++) {
      let y = arr[i * 3 + 1]
      y += 0.15 + Math.sin(time + i) * 0.06   // 步幅 ×3 补偿跳帧
      if (y > 130) y = 5
      arr[i * 3 + 1] = y
    }
    pos.needsUpdate = true
  }

  // Slow star rotation for parallax
  if (starField) {
    starField.rotation.y = time * 0.003
  }

  // Dynamically animate ocean waves if open scene
  if (currentAppMode.value !== 'entry' && currentScene.value === 'open' && groundGroup) {
    try {
      const ocean = groundGroup.children.find(c => c.name === "OceanGround") as THREE.Mesh
      if (ocean && ocean.geometry && ocean.geometry.attributes.position) {
        const pos = ocean.geometry.attributes.position as THREE.BufferAttribute
        for (let i = 0; i < pos.count; i++) {
          const vx = pos.getX(i)
          const vy = pos.getY(i)
          if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue;
          // 增强波浪振幅，使其在宏大比例尺下更加明显 (由 2~4m 增强至 12~18m 级海浪)
          const wave = Math.sin(vx * 0.02 + time * 2.0) * 8.0 + Math.cos(vy * 0.015 + time * 1.5) * 10.0
          pos.setZ(i, wave)
        }
        pos.needsUpdate = true
        // Only compute normals if it is fully supported to avoid WebGL memory sync crashes
        if (typeof ocean.geometry.computeVertexNormals === 'function') {
           ocean.geometry.computeVertexNormals() 
        }
      }
    } catch (e) {
      console.error("[WingNet] Lake scene wave animation error:", e)
    }
  }

  if (composer) {
    composer.render()
  } else if (renderer) {
    renderer.render(scene, camera)
  }
}

function handleResize() {
  if (!containerRef.value || !renderer) return
  const w = containerRef.value.clientWidth
  const h = containerRef.value.clientHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  if (composer) composer.setSize(w, h)
}

let resizeOb: ResizeObserver | null = null

// Watch for scene changes from ScenarioEditor (including mode switching)
watch([sceneVersion, sceneMode, geojsonMapData], () => {
  if (sceneGroup) rebuildSceneObjects()
})

function rebuildSceneObjects() {
  // Clear existing scene objects
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

  // Reload Dynamic Ground
  createGround()

  // Reset transform defaults to ensure clean state for manual mode
  geojsonTransform.scale = 1
  geojsonTransform.offsetX = 0
  geojsonTransform.offsetZ = 0

  // 双轨制：GeoJSON 模式用真实多边形，手动模式用 BoxGeometry
  if (sceneMode.value === 'geojson' && geojsonMapData.value) {
    createGeoJsonBuildings()
  } else {
    createBuildings()
  }
  updateWaypointMarkers()
}

function updateWaypointMarkers() {
  if (startMarkerRaw) { sceneGroup.remove(startMarkerRaw); startMarkerRaw = null }
  if (targetMarkerRaw) { sceneGroup.remove(targetMarkerRaw); targetMarkerRaw = null }

  startMarkerRaw = createWaypointMarker('START', 0x00ff88)
  const startCoords = missionWaypoints.start.split(',').map(Number)
  if (startCoords.length >= 2) {
    let sx = startCoords[0]
    let sz = startCoords[1]
    let sy = startCoords.length > 2 ? startCoords[2] : 0

    if (sceneMode.value === 'geojson' && geojsonMapData.value) {
      sx = sx * geojsonTransform.scale + geojsonTransform.offsetX
      // Invert Z for map display: (MapHeight - Y) * Scale
      sz = (geojsonMapData.value.map_height - sz) * geojsonTransform.scale + geojsonTransform.offsetZ
      sy = sy * geojsonTransform.scale
    }
    startMarkerRaw.position.set(sx, sy, sz)
  }
  sceneGroup.add(startMarkerRaw)

  targetMarkerRaw = createWaypointMarker('TARGET', 0xffaa00)
  const targetCoords = missionWaypoints.target.split(',').map(Number)
  if (targetCoords.length >= 2) {
    let tx = targetCoords[0]
    let tz = targetCoords[1]
    let ty = targetCoords.length > 2 ? targetCoords[2] : 0
    if (sceneMode.value === 'geojson' && geojsonMapData.value) {
      tx = tx * geojsonTransform.scale + geojsonTransform.offsetX
      // Invert Z for map display: (MapHeight - Y) * Scale
      tz = (geojsonMapData.value.map_height - tz) * geojsonTransform.scale + geojsonTransform.offsetZ
      ty = ty * geojsonTransform.scale
    }
    targetMarkerRaw.position.set(tx, ty, tz)
  }
  sceneGroup.add(targetMarkerRaw)
}

function createWaypointMarker(text: string, color: number) {
  const group = new THREE.Group()
  // Base ring
  const ringGeo = new THREE.RingGeometry(8, 10, 32)
  const ringMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.8 })
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 1
  group.add(ring)
  
  // Beam
  const beamGeo = new THREE.CylinderGeometry(1, 1, 80, 16)
  const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending })
  const beam = new THREE.Mesh(beamGeo, beamMat)
  beam.position.y = 40
  group.add(beam)

  // Label
  const colorStr = '#' + color.toString(16).padStart(6, '0')
  const label = createTextSprite(text, colorStr)
  label.position.y = 85
  label.scale.set(40, 20, 1)
  group.add(label)

  return group
}

watch(missionWaypoints, () => {
  updateWaypointMarkers()
}, { deep: true })

watch(() => selectedUAVId?.value, (val) => {
  if (val !== null && val !== undefined) {
    hoverInfo.value.show = false
  }
})

// ── 终端日志系统分析逻辑 ──
interface TerminalLogObj {
  id: number
  time: string
  level: string
  msg: string
}
const terminalLogs = ref<TerminalLogObj[]>([])
const terminalScrollRef = ref<HTMLDivElement | null>(null)
const terminalRef = ref<HTMLDivElement | null>(null)
let logIdCounter = 0

// Terminal Collapse State
const isTerminalCollapsed = ref(false)
const toggleTerminal = () => {
    isTerminalCollapsed.value = !isTerminalCollapsed.value
}

function startResizeTerminal(e: MouseEvent) {
  if (!terminalRef.value) return
  const startY = e.clientY
  const startH = terminalRef.value.clientHeight
  
  const onMove = (mv: MouseEvent) => {
    if (!terminalRef.value) return
    const dy = mv.clientY - startY
    // 向上拖动 (dy < 0) -> 高度增加
    const newH = Math.max(120, Math.min(600, startH - dy))
    terminalRef.value.style.height = `${newH}px`
    terminalRef.value.style.maxHeight = 'none'
  }
  
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
  }
  
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  document.body.style.cursor = 'ns-resize'
}

function addTerminalLog(level: string, msg: string, timeTick: number) {
  const timeStr = `[${(timeTick * 0.1).toFixed(1)}s]`
  terminalLogs.value.push({ id: logIdCounter++, time: timeStr, level, msg })
  if (terminalLogs.value.length > 40) terminalLogs.value.shift()
  nextTick(() => {
    if (terminalScrollRef.value) {
      terminalScrollRef.value.scrollTop = terminalScrollRef.value.scrollHeight
    }
  })
}

function fmtTargets(value: string | number[] | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.join('|')
  return String(value)
}

// 状态追踪器 (用于比较帧间变化)
let lastUavChannels: Record<number, number> = {}
let lastConnectivity = -1
let lastTotalPdr = -1
let systemStartedLogged = false
let seenTransmissionKeys = new Set<string>()
let loggedFailureEvents = new Set<string>()
let loggedRecoveryActions = new Set<string>()

watch(() => engine?.currentTick?.value, (val) => {
  if (val === 0) systemStartedLogged = false // 归零时重置标志
  if (val === 0) {
    loggedFailureEvents = new Set()
    loggedRecoveryActions = new Set()
  }
})

watch(frame, (newFrame) => {
  if (!newFrame) return
  const tick = newFrame.tick

  // 1. 系统启动日志
  if (tick === 0 && !systemStartedLogged) {
    terminalLogs.value = [] // clear logs
    addTerminalLog('SYSTEM', 'Wing-Net Omni 物理核心已激活.', tick)
    addTerminalLog('SWARM', `蜂群已部署，当前阵型: V字形，总规模: ${newFrame.uav_nodes.length}架.`, tick)
    addTerminalLog('AI', `资源调度引擎已挂载，等待关键链路事件.`, tick)
    systemStartedLogged = true
    
    lastUavChannels = {}
    lastConnectivity = -1
    lastTotalPdr = -1
    seenTransmissionKeys = new Set()
    loggedFailureEvents = new Set()
    loggedRecoveryActions = new Set()
  }

  if (tick > 0 && newFrame.uav_nodes) {
    if (currentAppMode.value === 'cooperative') {
      const failureEvents = workspaceData.cooperative?.failure_timeline?.events || []
      const recoveryActions = workspaceData.cooperative?.recovery_timeline?.actions || []

      for (const evt of failureEvents) {
        const eventTime = Number(evt?.time)
        if (!Number.isFinite(eventTime) || eventTime > tick) continue
        const key = `${eventTime}-${evt?.failureType}-${evt?.targetNodeId}`
        if (loggedFailureEvents.has(key)) continue
        loggedFailureEvents.add(key)
        addTerminalLog(
          'FAILURE',
          `故障开始：${eventTime.toFixed(1)}s，${evt?.failureType || 'unknown'} 命中 Node ${evt?.targetNodeId ?? '—'}，影响链路 ${evt?.affectedLinkCount ?? 0} 条。`,
          tick
        )
      }

      for (const act of recoveryActions) {
        const actionTime = Number(act?.time)
        if (!Number.isFinite(actionTime) || actionTime > tick) continue
        const key = `${actionTime}-${act?.actionType}-${act?.executorNodeId}-${fmtTargets(act?.targetNodeIds)}`
        if (loggedRecoveryActions.has(key)) continue
        loggedRecoveryActions.add(key)

        const resultState = String(act?.resultState || 'unknown')
        const prefix = ['completed', 'stable', 'recovered', 'success'].includes(resultState.toLowerCase())
          ? 'RECOVERY'
          : 'ACTION'
        addTerminalLog(
          prefix,
          `恢复动作：${actionTime.toFixed(1)}s，${act?.actionType || 'unknown'} 由 Node ${act?.executorNodeId ?? '—'} 执行，目标 ${fmtTargets(act?.targetNodeIds)}，结果 ${resultState}.`,
          tick
        )
      }
    }

    for (const uav of newFrame.uav_nodes) {
      lastUavChannels[uav.id] = uav.channel
    }

    // 2. 拓扑撕裂与自愈
    const currentConn = newFrame.topology?.connectivity || 0
    if (lastConnectivity !== -1) {
      if (currentConn < lastConnectivity - 0.1 && currentConn <= 0.6) {
        addTerminalLog('NETWORK', `拓扑断层：骨干链路显著下降，连通率跌至 ${(currentConn * 100).toFixed(1)}%.`, tick)
      } else if (currentConn > lastConnectivity + 0.1 && currentConn > 0.8) {
        addTerminalLog('NETWORK', `拓扑恢复：中继链路重建成功，连通率回升至 ${(currentConn * 100).toFixed(1)}%.`, tick)
      }
    }
    lastConnectivity = currentConn

    // 3. 重大 QoS 报文预警
    const currentPdr = newFrame.QoS?.total_pdr || 0
    const delay = newFrame.QoS?.p99_latency_ms || 0
    if (lastTotalPdr !== -1) {
      if (currentPdr < 0.85 && lastTotalPdr >= 0.85) {
        addTerminalLog('QoS', `PDR 包到达率骤降，当前全网平均: ${(currentPdr * 100).toFixed(1)}%.`, tick)
      }
      // 防节流：每 10 tick 且时延离谱时触发
      if (delay > 40 && tick % 10 === 0) {
        const worstUav = newFrame.uav_nodes.reduce((prev: any, curr: any) => (prev.delay > curr.delay) ? prev : curr)
        if (worstUav && worstUav.delay > 40) {
          addTerminalLog('QoS', `UAV-${String(worstUav.id).padStart(2,'0')} 发生严重拥塞，端到端时延突破 ${worstUav.delay.toFixed(1)}ms.`, tick)
        }
      }
    }
    lastTotalPdr = currentPdr

    const newTransmissionLogs = (newFrame.transmissions || [])
      .map((item: any) => ({
        time: Number(item.time ?? item.time_s ?? tick),
        nodeId: Number(item.nodeId ?? item.node_id ?? -1),
        eventType: String(item.eventType ?? item.event_type ?? 'TX_EVENT')
      }))
      .filter((item: any) => item.nodeId >= 0)
      .filter((item: any) => {
        const key = `${item.time.toFixed(2)}-${item.nodeId}-${item.eventType}`
        if (seenTransmissionKeys.has(key)) return false
        seenTransmissionKeys.add(key)
        return true
      })
      .slice(0, 1)

    if (tick % 10 === 0) {
      for (const tx of newTransmissionLogs) {
      addTerminalLog(
        'SWARM',
        `UAV-${String(tx.nodeId).padStart(2,'0')} 上报 ${tx.eventType} 事件，已记录关键链路活动.`,
        tick
      )
      }
    }
  }
})

watch(totalTicks, (ticks, oldTicks) => {
  if (ticks <= 0) {
    shouldAutoFocusOnNextDataset = false
    return
  }
  if (ticks !== oldTicks) {
    shouldAutoFocusOnNextDataset = true
  }
})

watch(frame, (currentFrame) => {
  if (!currentFrame || totalTicks.value <= 0) {
    return
  }

  const uavs = currentFrame.uav_nodes || []
  if (uavs.length === 0) return

  if (shouldAutoFocusOnNextDataset && currentTick.value === 0) {
    autoFocusOnUavs(uavs)
    shouldAutoFocusOnNextDataset = false
  }
}, { flush: 'post' })

onMounted(() => {
  initScene()
  animate()
  resizeOb = new ResizeObserver(handleResize)
  if (containerRef.value) resizeOb.observe(containerRef.value)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(animId)
  resizeOb?.disconnect()
  renderer?.dispose()
  renderer?.domElement.removeEventListener('mousedown', onMouseDown)
  renderer?.domElement.removeEventListener('mousemove', onMouseMove)
  renderer?.domElement.removeEventListener('mouseup', onMouseUp)
  renderer?.domElement.removeEventListener('wheel', onWheel)
  renderer?.domElement.removeEventListener('click', onClick)
})
</script>

<template>
  <div ref="containerRef" class="sandbox-container glass-panel">
    <div class="vignette-overlay"></div>
    <div class="camera-hint">
      🖱 拖拽平移 | Shift+拖拽旋转 | 滚轮缩放 | 点击选择
    </div>

    <!-- 信道颜色图例 -->
    <div class="channel-legend">
      <div class="legend-item">
        <span class="legend-dot" style="background: #23d7e6;"></span>
        <span>CH 1</span>
      </div>
      <div class="legend-item">
        <span class="legend-dot" style="background: #a855f7;"></span>
        <span>CH 2</span>
      </div>
      <div class="legend-item">
        <span class="legend-dot" style="background: #22c55e;"></span>
        <span>CH 3</span>
      </div>
      <div class="legend-item">
        <span class="legend-dot" style="background: #ef4444;"></span>
        <span>ROGUE</span>
      </div>
    </div>

    <!-- Terminal Restore Button (Show only when collapsed) -->
    <div 
      class="terminal-restore-btn" 
      :class="{ visible: isTerminalCollapsed }"
      @click="toggleTerminal"
    >
      <span class="restore-icon">▲</span>
      <span class="restore-text">TERMINAL</span>
    </div>

    <!-- Sandbox Terminal Logger -->
    <div class="sandbox-terminal" :class="{ collapsed: isTerminalCollapsed }" ref="terminalRef">
      <!-- Top Resize Handle -->
      <div 
        @mousedown.prevent="startResizeTerminal" 
        style="height: 6px; cursor: ns-resize; position: absolute; top: 0; left: 0; right: 0; z-index: 10;">
      </div>
      <div class="terminal-header">
        <span class="terminal-title">TERMINAL</span>
        <div class="terminal-controls">
          <button class="minimize-btn" @click.stop="toggleTerminal">─</button>
        </div>
      </div>
      <div class="terminal-body" ref="terminalScrollRef">
        <div v-for="log in terminalLogs" :key="log.id" class="log-entry">
          <span class="log-time">{{ log.time }}</span>
          <span class="log-level" :class="log.level.replace('-', '').toLowerCase()">[{{ log.level }}]</span>
          <span class="log-msg" :class="{
             warning: log.msg.includes('警告') || log.msg.includes('断层') || log.msg.includes('骤降') || log.msg.includes('拥塞'),
             danger: log.msg.includes('跌破') || log.msg.includes('严重'),
             success: log.msg.includes('成功') || log.msg.includes('恢复')
          }">{{ log.msg }}</span>
        </div>
      </div>
    </div>

    <!-- Hover Tooltip -->
    <Teleport to="body">
      <div
        v-if="hoverInfo.show && hoverInfo.uav"
        class="uav-hover-tooltip"
        :style="{ left: hoverInfo.x + 16 + 'px', top: hoverInfo.y - 10 + 'px' }"
      >
        <div class="tooltip-header">
          <span class="tooltip-id" :style="{
            background: ['#23d7e6','#8e82ff','#22c55e'][hoverInfo.uav.channel] || '#23d7e6',
            color: '#101827'
          }">UAV-{{ String(hoverInfo.uav.id).padStart(2, '0') }}</span>
          <span class="tooltip-ch">CH{{ hoverInfo.uav.channel + 1 }}</span>
        </div>
        <!-- 移除电量显示 -->
        <div class="tooltip-row">
          <span>📡 状态</span>
          <span class="tooltip-val" :class="{
            conflict: hoverInfo.uav.is_conflict,
            nlos: hoverInfo.uav.is_nlos && !hoverInfo.uav.is_conflict
          }">{{ hoverInfo.uav.is_conflict ? '同频冲突' : (hoverInfo.uav.is_nlos ? 'NLOS遮挡' : '正常') }}</span>
        </div>
        <div class="tooltip-row">
          <span>📍 坐标</span>
          <span class="tooltip-val">{{ hoverInfo.uav.x.toFixed(0) }}, {{ hoverInfo.uav.y.toFixed(0) }}, {{ (hoverInfo.uav.z || 30).toFixed(0) }}</span>
        </div>
        <div class="tooltip-row">
          <span>⚡ 功率</span>
          <span class="tooltip-val">{{ (hoverInfo.uav.power ?? 20).toFixed(1) }} dBm</span>
        </div>
        <div class="tooltip-row">
          <span>📶 干扰</span>
          <span class="tooltip-val" :class="{ low: (hoverInfo.uav.interference ?? -95) <= -75 }">{{ (hoverInfo.uav.interference ?? -95).toFixed(1) }} dBm</span>
        </div>
        <div class="tooltip-row">
          <span>🛰 SINR</span>
          <span class="tooltip-val" :class="{ low: (hoverInfo.uav.sinr ?? 0) < 10 }">{{ hoverInfo.uav.sinr !== undefined && hoverInfo.uav.sinr !== null ? hoverInfo.uav.sinr.toFixed(1) + ' dB' : '—' }}</span>
        </div>
        <div class="tooltip-row">
          <span>🏃 速度</span>
          <span class="tooltip-val">{{ hoverInfo.uav.speed !== undefined && hoverInfo.uav.speed !== null ? hoverInfo.uav.speed.toFixed(1) + ' m/s' : '—' }}</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.sandbox-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  padding: 0;
  background: radial-gradient(circle at top, rgba(53, 82, 122, 0.28), rgba(22, 32, 51, 0.96) 55%, rgba(18, 26, 41, 1) 100%);
}

.sandbox-container :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

.sandbox-label {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--font-display);
  font-size: 10px;
  letter-spacing: 4px;
  color: rgba(35, 215, 230, 0.4);
  pointer-events: none;
  z-index: 10;
}

.camera-hint {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--font-mono);
  font-size: 9px;
  color: rgba(182, 197, 212, 0.72);
  pointer-events: none;
  z-index: 10;
  background: rgba(28, 41, 64, 0.48);
  padding: 4px 12px;
  border-radius: 4px;
}

/* Legend */
.channel-legend {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  gap: 14px;
  background: rgba(30, 45, 70, 0.8);
  backdrop-filter: blur(12px);
  padding: 8px 14px;
  border-radius: 6px;
  border: 1px solid rgba(111, 159, 245, 0.14);
  pointer-events: none;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.22);
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
}
.legend-dot {
  width: 8px; 
  height: 8px;
  border-radius: 50%;
  box-shadow: 0 0 6px currentColor;
}

/* Terminal Overlay Styles */
.sandbox-terminal {
  position: absolute;
  bottom: 24px;
  left: 24px;
  width: min(480px, calc(100% - 48px));  /* ★ 响应式 */
  max-height: 220px;
  display: flex;
  flex-direction: column;
  background: rgba(30, 45, 70, 0.88);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(111, 159, 245, 0.16);
  border-radius: 8px;
  z-index: 20;
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.36),
    0 0 40px rgba(35, 215, 230, 0.04);
  pointer-events: auto;
  overflow: hidden;
  transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.6s ease;
}

.sandbox-terminal.collapsed {
  transform: translateY(150%);
  opacity: 0;
  pointer-events: none;
}

.terminal-restore-btn {
  position: absolute;
  bottom: 24px;
  left: 24px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(32, 48, 74, 0.92);
  border: 1px solid rgba(111, 159, 245, 0.24);
  border-radius: 4px;
  color: var(--cyan);
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 0 15px rgba(35, 215, 230, 0.16);
  
  opacity: 0;
  pointer-events: none;
  transform: translateY(20px);
  transition: all 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}

.terminal-restore-btn.visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.terminal-restore-btn:hover {
  background: rgba(35, 215, 230, 0.14);
  box-shadow: 0 0 25px rgba(35, 215, 230, 0.22);
  transform: translateY(-2px);
}

.terminal-header {
  padding: 5px 12px;
  background: linear-gradient(90deg,
    rgba(35, 215, 230, 0.08),
    rgba(142, 130, 255, 0.05),
    transparent);
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(111, 159, 245, 0.14);
}

.terminal-controls {
  display: flex;
  align-items: center;
}

.minimize-btn {
  background: transparent;
  border: none;
  color: rgba(182, 197, 212, 0.78);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 6px;
  transition: color 0.2s;
}

.minimize-btn:hover {
  color: #fff;
}

.terminal-title {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--cyan);
  letter-spacing: 1.5px;
  display: flex;
  align-items: center;
  gap: 6px;
}

@keyframes cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.terminal-title::before {
  content: '>';
  display: inline-block;
  color: var(--green);
  animation: cursor-blink 1s step-end infinite;
}

.terminal-dots {
  color: var(--cyan);
  letter-spacing: 2px;
}

.terminal-body {
  flex: 1;
  padding: 8px 10px;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  color: #cdd6f4;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.terminal-body::-webkit-scrollbar {
  width: 4px;
}
.terminal-body::-webkit-scrollbar-thumb {
  background: rgba(35, 215, 230, 0.28);
  border-radius: 2px;
}

.log-entry {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  word-break: break-all;
  animation: log-in 0.2s ease-out;
}

@keyframes log-in {
  from { opacity: 0; transform: translateX(10px); }
  to { opacity: 1; transform: translateX(0); }
}

.log-time {
  color: var(--text-dim);
  flex-shrink: 0;
}

.log-level {
  font-weight: bold;
  flex-shrink: 0;
  min-width: 80px;
}

.log-level.system { color: #a855f7; }
.log-level.env { color: var(--green); }
.log-level.swarm { color: var(--cyan); }
.log-level.ai { color: var(--yellow); }
.log-level.aicore { color: var(--yellow); }
.log-level.network { color: var(--red); }
.log-level.qos { color: var(--orange); }

.log-msg {
  flex: 1;
}

.log-msg.warning { color: var(--orange); }
.log-msg.danger { color: var(--red); text-shadow: 0 0 6px rgba(239,68,68,0.34); font-weight: bold; }
.log-msg.success { color: var(--green); text-shadow: 0 0 6px rgba(34,197,94,0.24); }

/* Lock-on Vignette */
.vignette-overlay {
  position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(circle at center, transparent 45%, rgba(0,0,0,0.18) 120%);
  opacity: 1;
  z-index: 10;
}
</style>

<style>
/* Global (unscoped) styles for the hover tooltip teleported to body */
.uav-hover-tooltip {
  position: fixed;
  z-index: 10000;
  pointer-events: none;
  background: rgba(32, 48, 74, 0.94);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(111, 159, 245, 0.18);
  border-radius: 8px;
  padding: 10px 14px;
  min-width: 160px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.34), 0 0 20px rgba(35, 215, 230, 0.08);
  animation: tooltipIn 0.15s ease;
}

@keyframes tooltipIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.tooltip-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(111, 159, 245, 0.12);
}

.tooltip-id {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
}

.tooltip-ch {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-secondary);
}

.tooltip-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary);
  padding: 2px 0;
  font-family: var(--font-body);
}

.tooltip-val {
  font-family: var(--font-mono);
  color: var(--text-primary);
  font-weight: 500;
}

.tooltip-val.conflict {
  color: var(--red);
  text-shadow: 0 0 6px rgba(239, 68, 68, 0.34);
}

.tooltip-val.nlos {
  color: var(--orange);
}

.tooltip-val.low {
  color: var(--red);
}
</style>

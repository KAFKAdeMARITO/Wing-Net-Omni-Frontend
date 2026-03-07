<script setup lang="ts">
import { ref, inject, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import type { UAVNode, BuildingBlock } from '../types'
import { activeScene, sceneVersion, missionWaypoints, interactionState } from '../composables/useScene'

// Hover tooltip state
const hoverInfo = ref<{ show: boolean; x: number; y: number; uav: UAVNode | null }>({
  show: false, x: 0, y: 0, uav: null
})
const selectedUAVId = inject<any>('selectedUAV')

const emit = defineEmits<{
  (e: 'select-uav', uav: UAVNode | null): void
}>()

const engine = inject<any>('engine')
const frame = computed(() => engine?.currentFrame?.value)

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
let interpPositions: Map<number, { x: number; y: number; z: number }> = new Map()
let uavTrails: Map<number, THREE.Vector3[]> = new Map()
let trailLines: Map<number, THREE.Line> = new Map()
let starField: THREE.Points
let envParticles: THREE.Points

// Interference zone dynamic meshes (for animate pulse)
let zoneDynamicMeshes: { cylinder: THREE.Mesh; wire: THREE.Mesh; ring: THREE.Mesh }[] = []

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
const channelColors = [0x00f2ff, 0xa855f7, 0x00ff88]
const channelHexStr = ['#00f2ff', '#a855f7', '#00ff88']

/** 实时 NLOS 检测: 基于 activeScene 的当前建筑物 */
function checkNLOSDynamic(x: number, y: number): boolean {
  for (const b of activeScene.buildings) {
    const dx = x - (b.x + b.width / 2)
    const dy = y - (b.y + b.depth / 2)
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < (b.width + b.depth) / 2 + 15) return true
  }
  return false
}

function initScene() {
  if (!containerRef.value) return

  const w = containerRef.value.clientWidth
  const h = containerRef.value.clientHeight

  // Scene
  scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x040714, 0.0008)

  // Camera
  camera = new THREE.PerspectiveCamera(50, w / h, 1, 2000)
  updateCameraPosition()

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(w, h)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x040714)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  containerRef.value.appendChild(renderer.domElement)
  renderer.domElement.style.cursor = 'grab'

  clock = new THREE.Clock()

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x1a2040, 1.5)
  scene.add(ambientLight)

  const dirLight = new THREE.DirectionalLight(0x4488cc, 0.8)
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

  const hemiLight = new THREE.HemisphereLight(0x0f1535, 0x000510, 0.6)
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

  // Starfield background
  createStarfield()

  // Floating environment particles
  createEnvParticles()

  // Rebuildable scene objects
  sceneGroup = new THREE.Group()
  scene.add(sceneGroup)
  rebuildSceneObjects()

  // Groups for dynamic objects
  linkLines = new THREE.Group()
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
  // Ground plane
  const groundGeo = new THREE.PlaneGeometry(GRID, GRID)
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x0a0e27,
    roughness: 0.9,
    metalness: 0.1,
  })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.set(GRID / 2, -0.5, GRID / 2)
  ground.receiveShadow = true
  scene.add(ground)

  // Grid helper
  const gridHelper = new THREE.GridHelper(GRID, 12, 0x00f2ff, 0x00f2ff)
  gridHelper.position.set(GRID / 2, 0, GRID / 2)
  gridHelper.material.opacity = 0.06
  gridHelper.material.transparent = true
  scene.add(gridHelper)

  // Glowing edge border
  const borderGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(GRID, 0.5, GRID))
  const borderMat = new THREE.LineBasicMaterial({ color: 0x00f2ff, transparent: true, opacity: 0.15 })
  const borderLine = new THREE.LineSegments(borderGeo, borderMat)
  borderLine.position.set(GRID / 2, 0, GRID / 2)
  scene.add(borderLine)
  
  // Set user data for ground to identify it in raycast
  ground.userData.isGround = true

  // Broken links particle group
  brokenLinksGroup = new THREE.Group()
  brokenLinksGroup.name = 'brokenLinksGroup'
  scene.add(brokenLinksGroup)
}

function createBuildings() {
  for (const b of activeScene.buildings) {
    const h = b.height * 0.8 // scale for visual
    const geo = new THREE.BoxGeometry(b.width, h, b.depth)

    // Building material - glossy obsidian/space glass
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x0a1128, // darker blue/black obsidian base
      emissive: 0x001133,
      roughness: 0.1,  // very smooth
      metalness: 0.8,  // highly metallic
      clearcoat: 1.0,  // extra shiny coat
      clearcoatRoughness: 0.1,
      transparent: true,
      opacity: 0.9,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(b.x + b.width / 2, h / 2, b.y + b.depth / 2)
    mesh.castShadow = true
    mesh.receiveShadow = true
    sceneGroup.add(mesh)

    // Wireframe edges for cyber look
    const edgeGeo = new THREE.EdgesGeometry(geo)
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x00f2ff,
      transparent: true,
      opacity: 0.2,
    })
    const edges = new THREE.LineSegments(edgeGeo, edgeMat)
    edges.position.copy(mesh.position)
    sceneGroup.add(edges)

    // Window lights (small emissive planes on faces)
    createWindowLights(b, h)

    // Height label using sprite
    const labelSprite = createTextSprite(`${Math.round(b.height)}m`, '#00f2ff')
    labelSprite.position.set(b.x + b.width / 2, h + 8, b.y + b.depth / 2)
    labelSprite.scale.set(20, 10, 1)
    sceneGroup.add(labelSprite)
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

function createInterferenceZones() {
  zoneDynamicMeshes = []
  for (const zone of activeScene.interferenceZones) {
    // Holographic dual-layer cylinder base
    const cylGeo = new THREE.CylinderGeometry(zone.radius, zone.radius, 80, 32, 1, true)
    
    // Inner solid core
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xff3b3b,
      transparent: true,
      opacity: 0.05,
      side: THREE.DoubleSide,
    })
    const cylinder = new THREE.Mesh(cylGeo, coreMat)
    cylinder.position.set(zone.x, 40, zone.y)
    sceneGroup.add(cylinder)

    // Outer wireframe holo-grid
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xff3b3b,
      transparent: true,
      opacity: 0.15,
      wireframe: true
    })
    const wireCylinder = new THREE.Mesh(cylGeo, wireMat)
    wireCylinder.position.set(zone.x, 40, zone.y)
    wireCylinder.scale.set(1.01, 1, 1.01)
    sceneGroup.add(wireCylinder)

    // Ground ring
    const ringGeo = new THREE.RingGeometry(zone.radius - 1, zone.radius + 1, 64)
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff3b3b,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.set(zone.x, 0.5, zone.y)
    sceneGroup.add(ring)

    // Label
    const label = createTextSprite('⚡ EMI ZONE', '#ff3b3b')
    label.position.set(zone.x, 5, zone.y)
    label.scale.set(30, 15, 1)
    sceneGroup.add(label)

    // Store refs for animation
    zoneDynamicMeshes.push({ cylinder, wire: wireCylinder, ring })
  }
}

function createTextSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 256, 128)
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

function createUAVMesh(uav: UAVNode): THREE.Group {
  const group = new THREE.Group()
  const color = channelColors[uav.channel] || 0x00f2ff

  // Main body - octahedron
  const bodyGeo = new THREE.OctahedronGeometry(4, 0)
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: color,
    emissive: color,
    emissiveIntensity: 0.5,
    roughness: 0.2,
    metalness: 0.8,
  })
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  body.castShadow = true
  group.add(body)

  // Propeller arms (4 arms)
  for (let i = 0; i < 4; i++) {
    const armGeo = new THREE.CylinderGeometry(0.3, 0.3, 8, 4)
    const armMat = new THREE.MeshStandardMaterial({ color: 0x445566, metalness: 0.8 })
    const arm = new THREE.Mesh(armGeo, armMat)
    arm.rotation.z = Math.PI / 2
    arm.rotation.y = (i * Math.PI) / 2
    arm.position.set(
      Math.cos((i * Math.PI) / 2) * 4,
      0,
      Math.sin((i * Math.PI) / 2) * 4
    )
    group.add(arm)

    // Propeller disc
    const propGeo = new THREE.CircleGeometry(2.5, 16)
    const propMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
    })
    const prop = new THREE.Mesh(propGeo, propMat)
    prop.rotation.x = -Math.PI / 2
    prop.position.set(
      Math.cos((i * Math.PI) / 2) * 4,
      1,
      Math.sin((i * Math.PI) / 2) * 4
    )
    prop.userData.isPropeller = true
    group.add(prop)
  }

  // Glow point light
  const glow = new THREE.PointLight(color, 0.5, 50)
  glow.position.set(0, -2, 0)
  group.add(glow)

  // ID label
  const label = createTextSprite(`${uav.id}`, channelHexStr[uav.channel] || '#00f2ff')
  label.position.set(0, 10, 0)
  label.scale.set(12, 6, 1)
  group.add(label)

  // Interference Sphere (Hidden by default, radius 17.5 = 35m diameter threshold)
  const sphereGeo = new THREE.SphereGeometry(17.5, 32, 32)
  const sphereMat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.1,
    wireframe: true
  })
  const intSphere = new THREE.Mesh(sphereGeo, sphereMat)
  intSphere.visible = false
  group.add(intSphere)

  // Also add a more solid inner core for the interference
  const coreMat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.05,
    side: THREE.BackSide
  })
  const intCore = new THREE.Mesh(sphereGeo, coreMat)
  intCore.visible = false
  group.add(intCore)

  // 1. Dynamic Channel Aura
  const auraGeo = new THREE.RingGeometry(5, 7, 32)
  const auraMat = new THREE.MeshBasicMaterial({
    color: color,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })
  const channelAura = new THREE.Mesh(auraGeo, auraMat)
  channelAura.rotation.x = -Math.PI / 2
  channelAura.position.y = -3
  group.add(channelAura)

  // 2. Adaptive Power Shield
  const shieldGeo = new THREE.SphereGeometry(6, 32, 32)
  const shieldMat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.1,
    wireframe: true,
    blending: THREE.AdditiveBlending
  })
  const powerShield = new THREE.Mesh(shieldGeo, shieldMat)
  group.add(powerShield)

  group.userData.uavId = uav.id
  group.userData.interferenceMeshes = [intSphere, intCore]
  group.userData.channelAura = channelAura
  group.userData.powerShield = powerShield
  return group
}

function updateUAVs() {
  if (!frame.value || !frame.value.uav_nodes) return
  const uavs: UAVNode[] = frame.value.uav_nodes
  const time = clock.getElapsedTime()

  for (const uav of uavs) {
    // Interpolate positions
    const prev = interpPositions.get(uav.id)
    const targetY = 30 + uav.id * 3 + Math.sin(time * 2 + uav.id) * 2 // Hover effect
    if (prev) {
      interpPositions.set(uav.id, {
        x: prev.x + (uav.x - prev.x) * 0.08,
        y: prev.y + (targetY - prev.y) * 0.08,
        z: prev.z + (uav.y - prev.z) * 0.08,
      })
    } else {
      interpPositions.set(uav.id, { x: uav.x, y: targetY, z: uav.y })
    }

    const pos = interpPositions.get(uav.id)!
    let mesh = uavMeshes.get(uav.id)

    if (!mesh) {
      mesh = createUAVMesh(uav)
      uavMeshes.set(uav.id, mesh)
      scene.add(mesh)
    }

    mesh.position.set(pos.x, pos.y, pos.z)

    // Conflict shaking and interference sphere visibility
    if (mesh.userData.interferenceMeshes) {
      mesh.userData.interferenceMeshes.forEach((m: THREE.Mesh) => {
        m.visible = !!uav.is_conflict
        if (uav.is_conflict) {
          // Pulse the sphere slightly
          const scale = 1 + Math.sin(time * 5) * 0.05
          m.scale.set(scale, scale, scale)
        }
      })
    }

    if (uav.is_conflict) {
      mesh.position.x += Math.sin(time * 15) * 1.5
      mesh.position.z += Math.cos(time * 18) * 1.5
    }

    // ── 干扰圈内 UAV 视觉效果 ──
    if (uav.is_in_zone) {
      // 红色警告抖动（比冲突轻微）
      mesh.position.x += Math.sin(time * 8 + uav.id) * 0.8
      mesh.position.z += Math.cos(time * 10 + uav.id) * 0.8

      // 动态修改 body 发射颜色为红色脉冲
      const body = mesh.children[0] as THREE.Mesh
      if (body && (body as any).material?.emissive) {
        const pulse = 0.5 + Math.sin(time * 6) * 0.5
        ;(body.material as THREE.MeshPhysicalMaterial).emissive.setHex(0xff3b3b)
        ;(body.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.5 + pulse * 0.5
      }

      // 显示/更新 EMI 警告标签
      if (!mesh.userData.emiLabel) {
        const emiLabel = createTextSprite('⚠ EMI', '#ff3b3b')
        emiLabel.position.set(0, 16, 0)
        emiLabel.scale.set(16, 8, 1)
        mesh.add(emiLabel)
        mesh.userData.emiLabel = emiLabel
      }
      mesh.userData.emiLabel.visible = true
      // Pulse the label
      const labelScale = 1 + Math.sin(time * 4) * 0.15
      mesh.userData.emiLabel.scale.set(16 * labelScale, 8 * labelScale, 1)

      // Glow light pulsing red
      const glow = mesh.children.find((c: any) => c instanceof THREE.PointLight) as THREE.PointLight
      if (glow) {
        glow.color.setHex(0xff3b3b)
        glow.intensity = 0.5 + Math.sin(time * 5) * 0.3
      }
    } else {
      // Restore normal state
      const body = mesh.children[0] as THREE.Mesh
      if (body && (body as any).material?.emissive) {
        const origColor = channelColors[uav.channel] || 0x00f2ff
        ;(body.material as THREE.MeshPhysicalMaterial).emissive.setHex(origColor)
        ;(body.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.5
      }
      if (mesh.userData.emiLabel) {
        mesh.userData.emiLabel.visible = false
      }
      // Restore glow
      const glow = mesh.children.find((c: any) => c instanceof THREE.PointLight) as THREE.PointLight
      if (glow) {
        glow.color.setHex(channelColors[uav.channel] || 0x00f2ff)
        glow.intensity = 0.5
      }
    }

    // ── 1. 动态信道光环特效 ──
    if (mesh.userData.channelAura) {
      const aura = mesh.userData.channelAura as THREE.Mesh
      const chColor = channelColors[uav.channel] || 0x00f2ff
      ;(aura.material as THREE.MeshBasicMaterial).color.setHex(chColor)
      
      // 添加呼吸缩放效果
      const pulse = 1 + Math.sin(time * 6 + uav.id) * 0.2
      aura.scale.set(pulse, pulse, pulse)
    }

    // ── 2. 自适应功率护盾特效 ──
    if (mesh.userData.powerShield) {
      const shield = mesh.userData.powerShield as THREE.Mesh
      const power = uav.power || 20
      
      // 随着 power (20 -> 26+) 增强护盾厚度和大小
      // 正常 20 时，scale = 1.0；达到界限 26 时，scale 显著撑大雷达波
      let sScale = 1.0 + Math.max(0, (power - 20) * 0.15)
      shield.scale.set(sScale, sScale, sScale)

      const shMat = shield.material as THREE.MeshBasicMaterial
      if (power >= 25) {
        // 极限功率穿透，瞬间爆红
        shMat.color.setHex(0xff3b3b)
        shMat.opacity = 0.35 + Math.sin(time * 15) * 0.15 // 急促闪烁
      } else {
        shMat.color.setHex(channelColors[uav.channel] || 0x00f2ff)
        shMat.opacity = 0.1 + Math.max(0, (power - 20) * 0.05)
      }
    }

    // Rotate propellers
    mesh.children.forEach((child) => {
      if ((child as THREE.Mesh).userData?.isPropeller) {
        (child as THREE.Mesh).rotation.z = time * 15 + uav.id
      }
    })

    // Dynamic Orientation based on velocity
    if (prev) {
      const vx = uav.x - prev.x;
      const vz = uav.y - prev.z;
      const speed = Math.sqrt(vx * vx + vz * vz);
      
      if (speed > 0.05) {
        // Change rotation order so Yaw (Y) is applied first, then Pitch (X), then Bank (Z)
        mesh.rotation.order = 'YXZ';
        
        let targetYaw = Math.atan2(vx, vz);
        let currYaw = mesh.userData.yaw || 0;
        let diff = targetYaw - currYaw;
        // Normalize diff to [-PI, PI]
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        
        // Smooth yaw rotation
        currYaw += diff * 0.1;
        mesh.userData.yaw = currYaw;
        mesh.rotation.y = currYaw;
        
        // Calculate turning rate for Bank (Roll)
        let turnRate = diff * 0.1;
        const targetRoll = -turnRate * 12; // Bank into the turn (压弯倾斜)
        
        // Calculate pitch based on speed
        const targetPitch = Math.min(speed * 0.05, 0.4); // Pitch forward when flying
        
        // Smoothly apply pitch and roll
        mesh.rotation.x += (targetPitch - mesh.rotation.x) * 0.1;
        mesh.rotation.z += (targetRoll - mesh.rotation.z) * 0.1;
      } else {
        // Hovering states
        mesh.rotation.z += (Math.sin(time + uav.id) * 0.05 - mesh.rotation.z) * 0.1;
        mesh.rotation.x += (Math.cos(time * 0.7 + uav.id) * 0.03 - mesh.rotation.x) * 0.1;
      }
    } else {
      mesh.rotation.z = Math.sin(time + uav.id) * 0.05
      mesh.rotation.x = Math.cos(time * 0.7 + uav.id) * 0.03
    }

    // Update Flight Trails
    if (!uavTrails.has(uav.id)) uavTrails.set(uav.id, [])
    const trail = uavTrails.get(uav.id)!
    trail.push(new THREE.Vector3(pos.x, pos.y, pos.z))
    if (trail.length > 25) trail.shift()

    let line = trailLines.get(uav.id)
    if (!line) {
      // Create a geometry with a fixed buffer size (25 points)
      const geo = new THREE.BufferGeometry()
      const posArr = new Float32Array(25 * 3)
      geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3))
      
      const mat = new THREE.LineBasicMaterial({
        color: channelHexStr[uav.channel] || 0x00f2ff,
        transparent: true,
        opacity: 0.6
      })
      line = new THREE.Line(geo, mat)
      trailLines.set(uav.id, line)
      trailGroup.add(line)
    }

    // Update trail geometry without disposing
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
  if (!frame.value || !frame.value.uav_nodes || !linkSegmentsMesh || !flowPointsMesh) return
  const uavs: UAVNode[] = frame.value.uav_nodes
  const time = clock.getElapsedTime()
  const selId = selectedUAVId?.value?.id ?? null

  const currentLinkIds = new Set<string>()
  const connectedPairs: [UAVNode, UAVNode][] = []

  // 1. Dynamic Parsing (Faster caching)
  const uavMap = new Map<number, UAVNode>()
  uavs.forEach(u => uavMap.set(u.id, u))

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
          connectedPairs.push([a, b])
          const linkId = idA < idB ? `${idA}-${idB}` : `${idB}-${idA}`
          currentLinkIds.add(linkId)
        }
      }
    }
  } else {
    // Distance-based (Distance check is O(N^2), but N=15 is small)
    for (let i = 0; i < uavs.length; i++) {
      for (let j = i + 1; j < uavs.length; j++) {
        const a = uavs[i], b = uavs[j]
        if (Math.hypot(a.x - b.x, a.y - b.y) <= 120) {
          connectedPairs.push([a, b])
          const linkId = `${a.id}-${b.id}`
          currentLinkIds.add(linkId)
        }
      }
    }
  }

  // 2. Broken sparks
  for (const prevLink of previousFrameLinks) {
    if (!currentLinkIds.has(prevLink)) {
      const parts = prevLink.split('-')
      const posA = interpPositions.get(parseInt(parts[0]))
      const posB = interpPositions.get(parseInt(parts[1]))
      if (posA && posB) createBrokenSpark(posA, posB)
    }
  }
  previousFrameLinks = currentLinkIds

  // 3. Update unified Link Segments
  const positions: number[] = []
  const colors: number[] = []
  const flowPositions: number[] = []
  const flowColors: number[] = []

  const colorCache = new THREE.Color()

  for (let i = 0; i < connectedPairs.length; i++) {
    const [a, b] = connectedPairs[i]
    const posA = interpPositions.get(a.id) || { x: a.x, y: 40, z: a.y }
    const posB = interpPositions.get(b.id) || { x: b.x, y: 40, z: b.y }

    let baseColor = 0x00f2ff
    let opacity = 0.15

    if (a.is_conflict || b.is_conflict) {
      baseColor = 0xff3b3b
      opacity = 0.4 + Math.sin(time * 10) * 0.3
    } else if (checkNLOSDynamic(a.x, a.y) || checkNLOSDynamic(b.x, b.y)) {
      baseColor = 0xffaa00
      opacity = 0.3
    }

    if (selId !== null) {
      if (a.id === selId || b.id === selId) opacity = Math.min(opacity * 2.5, 0.9)
      else opacity *= 0.15
    }

    colorCache.setHex(baseColor)
    
    // Add to static segments
    positions.push(posA.x, posA.y, posA.z, posB.x, posB.y, posB.z)
    colors.push(colorCache.r, colorCache.g, colorCache.b, opacity)
    colors.push(colorCache.r, colorCache.g, colorCache.b, opacity)

    // Add to flow points
    if (opacity > 0.05) {
      const dir = b.id > a.id ? 1 : -1
      const speed = (a.is_conflict || b.is_conflict) ? 0.5 : 2.5
      for (let k = 0; k < 3; k++) {
        const t = (time * speed + k * 0.33) % 1.0
        const actualT = dir === 1 ? t : 1 - t
        flowPositions.push(
          posA.x + (posB.x - posA.x) * actualT,
          posA.y + (posB.y - posA.y) * actualT,
          posA.z + (posB.z - posA.z) * actualT
        )
        flowColors.push(colorCache.r, colorCache.g, colorCache.b, opacity * 1.5)
      }
    }
  }

  // Update geometry attributes with minimal allocation
  const linkGeo = linkSegmentsMesh.geometry
  if (!linkGeo.attributes.position || linkGeo.attributes.position.count < positions.length / 3) {
    linkGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    linkGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4))
  } else {
    linkGeo.attributes.position.copyArray(new Float32Array(positions))
    linkGeo.attributes.color.copyArray(new Float32Array(colors))
    linkGeo.setDrawRange(0, positions.length / 3)
    linkGeo.attributes.position.needsUpdate = true
    linkGeo.attributes.color.needsUpdate = true
  }

  const fGeo = flowPointsMesh.geometry
  if (!fGeo.attributes.position || fGeo.attributes.position.count < flowPositions.length / 3) {
    fGeo.setAttribute('position', new THREE.Float32BufferAttribute(flowPositions, 3))
    fGeo.setAttribute('color', new THREE.Float32BufferAttribute(flowColors, 4))
  } else {
    fGeo.attributes.position.copyArray(new Float32Array(flowPositions))
    fGeo.attributes.color.copyArray(new Float32Array(flowColors))
    fGeo.setDrawRange(0, flowPositions.length / 3)
    fGeo.attributes.position.needsUpdate = true
    fGeo.attributes.color.needsUpdate = true
  }
}

function createBrokenSpark(posA: {x:number, y:number, z:number}, posB: {x:number, y:number, z:number}) {
  const cx = (posA.x + posB.x) / 2
  const cy = (posA.y + posB.y) / 2
  const cz = (posA.z + posB.z) / 2

  const grp = new THREE.Group()
  grp.position.set(cx, cy, cz)

  // Blinking Red Light
  const light = new THREE.PointLight(0xff3b3b, 8.0, 40)
  grp.add(light)

  if (brokenLinksGroup) {
    brokenLinksGroup.add(grp)
    brokenLinkParticles.push({ obj: grp, timeRemaining: 1.0 }) // Live for 1.0 seconds
  }
}

function updateBrokenSparks(delta: number) {
  if (!brokenLinksGroup) return
  for (let i = brokenLinkParticles.length - 1; i >= 0; i--) {
    const p = brokenLinkParticles[i]
    p.timeRemaining -= delta
    
    // Light Flicker: High frequency
    const light = p.obj.children.find((c: any) => c instanceof THREE.PointLight) as THREE.PointLight
    if (light) {
      light.intensity = Math.max(0, p.timeRemaining * 10.0 * (0.2 + Math.random() * 0.8))
    }

    if (p.timeRemaining <= 0) {
      if (brokenLinksGroup) brokenLinksGroup.remove(p.obj)
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

function onMouseDown(e: MouseEvent) {
  isDragging = true
  prevMouse = { x: e.clientX, y: e.clientY }
  renderer.domElement.style.cursor = 'grabbing'
}

function onMouseMove(e: MouseEvent) {
  if (isDragging) {
    hoverInfo.value.show = false
    const dx = e.clientX - prevMouse.x
    const dy = e.clientY - prevMouse.y
    prevMouse = { x: e.clientX, y: e.clientY }

    if (e.shiftKey || e.buttons === 4) {
      const right = new THREE.Vector3()
      const up = new THREE.Vector3(0, 1, 0)
      camera.getWorldDirection(right)
      right.cross(up).normalize()
      cameraTarget.addScaledVector(right, -dx * 0.5)
      cameraTarget.y += dy * 0.5
    } else {
      cameraAngle.theta -= dx * 0.005
      cameraAngle.phi = Math.max(0.1, Math.min(Math.PI * 0.45, cameraAngle.phi + dy * 0.005))
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
  if (interactionState.mode !== 'none') {
    const groundIntersect = raycaster.intersectObjects(scene.children, true).find(i => i.object.userData.isGround)
    if (groundIntersect) {
      const pt = groundIntersect.point
      const coords = `${Math.round(pt.x)},${Math.round(pt.z)},30`
      if (interactionState.mode === 'setStart') {
        missionWaypoints.start = coords
      } else {
        missionWaypoints.target = coords
      }
      interactionState.mode = 'none'
      renderer.domElement.style.cursor = 'grab'
      updateWaypointMarkers()
    }
    return
  }

  if (!frame.value) return
  const meshes = Array.from(uavMeshes.values())
  const intersects = raycaster.intersectObjects(meshes, true)

  if (intersects.length > 0) {
    let obj: THREE.Object3D | null = intersects[0].object
    while (obj && obj.userData.uavId === undefined) obj = obj.parent
    if (obj && obj.userData.uavId !== undefined) {
      const uav = frame.value.uav_nodes.find((u: UAVNode) => u.id === obj!.userData.uavId)
      if (uav) { emit('select-uav', uav); return }
    }
  }
  emit('select-uav', null)
}

function animate() {
  animId = requestAnimationFrame(animate)
  const time = clock.getElapsedTime()
  const delta = clock.getDelta() // Using internal delta might skip if not polled carefully, but rough delta is 0.016
  updateUAVs()
  updateLinks()
  updateBrokenSparks(0.016)

  // Animate environment particles (gentle float)
  if (envParticles) {
    const pos = envParticles.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i)
      y += 0.05 + Math.sin(time + i) * 0.02
      if (y > 130) y = 5
      pos.setY(i, y)
    }
    pos.needsUpdate = true
  }

  // Slow star rotation for parallax
  if (starField) {
    starField.rotation.y = time * 0.003
  }

  // ── 干扰圈动态动画 ──
  for (const zm of zoneDynamicMeshes) {
    // Wireframe slow rotation
    zm.wire.rotation.y = time * 0.3
    // Core opacity breathing
    const breathe = 0.03 + Math.sin(time * 2) * 0.03
    ;(zm.cylinder.material as THREE.MeshBasicMaterial).opacity = breathe
    // Ring pulsing opacity
    const ringPulse = 0.2 + Math.sin(time * 3) * 0.15
    ;(zm.ring.material as THREE.MeshBasicMaterial).opacity = ringPulse
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

// Watch for scene changes from ScenarioEditor
watch(sceneVersion, () => {
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
  createBuildings()
  createInterferenceZones()
  updateWaypointMarkers()
}

function updateWaypointMarkers() {
  if (startMarkerRaw) { sceneGroup.remove(startMarkerRaw); startMarkerRaw = null }
  if (targetMarkerRaw) { sceneGroup.remove(targetMarkerRaw); targetMarkerRaw = null }

  startMarkerRaw = createWaypointMarker('START\n' + missionWaypoints.start, 0x00ff88)
  const startCoords = missionWaypoints.start.split(',').map(Number)
  if (startCoords.length >= 2) startMarkerRaw.position.set(startCoords[0], 0, startCoords[1])
  sceneGroup.add(startMarkerRaw)

  targetMarkerRaw = createWaypointMarker('TARGET\n' + missionWaypoints.target, 0xffaa00)
  const targetCoords = missionWaypoints.target.split(',').map(Number)
  if (targetCoords.length >= 2) targetMarkerRaw.position.set(targetCoords[0], 0, targetCoords[1])
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
  if (val) {
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
let logIdCounter = 0

function addTerminalLog(level: string, msg: string, timeTick: number) {
  const timeStr = `[${(timeTick * 0.1).toFixed(1)}s]`
  terminalLogs.value.push({ id: logIdCounter++, time: timeStr, level, msg })
  if (terminalLogs.value.length > 100) terminalLogs.value.shift()
  nextTick(() => {
    if (terminalScrollRef.value) {
      terminalScrollRef.value.scrollTop = terminalScrollRef.value.scrollHeight
    }
  })
}

// 状态追踪器 (用于比较帧间变化)
let lastUavChannels: Record<number, number> = {}
let lastConnectivity = -1
let lastTotalPdr = -1
let systemStartedLogged = false

watch(() => engine?.currentTick?.value, (val) => {
  if (val === 0) systemStartedLogged = false // 归零时重置标志
})

watch(frame, (newFrame) => {
  if (!newFrame) return
  const tick = newFrame.tick

  // 1. 系统启动日志
  if (tick === 0 && !systemStartedLogged) {
    terminalLogs.value = [] // clear logs
    addTerminalLog('SYSTEM', 'Wing-Net Omni 物理核心已激活.', tick)
    addTerminalLog('ENV', `成功加载数字高程模型，约束区(大厦)数量: ${activeScene.buildings.length}.`, tick)
    addTerminalLog('SWARM', `蜂群已部署，当前阵型: V字形，总规模: ${newFrame.uav_nodes.length}架.`, tick)
    addTerminalLog('AI', `分布式图着色资源分配引擎 [AI Dynamic] 挂载成功.`, tick)
    systemStartedLogged = true
    
    lastUavChannels = {}
    lastConnectivity = -1
    lastTotalPdr = -1
  }

  if (tick > 0 && newFrame.uav_nodes) {
    // 2. AI 信道博弈感知
    for (const uav of newFrame.uav_nodes) {
      const prevCh = lastUavChannels[uav.id]
      if (prevCh !== undefined && prevCh !== uav.channel) {
        addTerminalLog('AI-CORE', `警告：UAV-${String(uav.id).padStart(2,'0')} 检测到局部强干扰.`, tick)
        addTerminalLog('AI-CORE', `执行动态图着色跳频：UAV-${String(uav.id).padStart(2,'0')} 信道从 CH${prevCh+1} -> CH${uav.channel+1}.`, tick)
        addTerminalLog('AI-CORE', `UAV-${String(uav.id).padStart(2,'0')} 发射功率自动补偿至 22.5 dBm 以穿透障碍物.`, tick)
      }
      lastUavChannels[uav.id] = uav.channel
    }

    // 3. 拓扑撕裂与自愈
    const currentConn = newFrame.topology?.connectivity || 0
    if (lastConnectivity !== -1) {
      if (currentConn < lastConnectivity - 0.1 && currentConn <= 0.6) {
        addTerminalLog('NETWORK', `⚠️ 拓扑断层：骨干链路因建筑遮挡断开.`, tick)
        addTerminalLog('NETWORK', `🚨 网络连通率跌破警戒线：当前活跃链路急剧下降.`, tick)
      } else if (currentConn > lastConnectivity + 0.1 && currentConn > 0.8) {
        addTerminalLog('NETWORK', `🟢 拓扑自愈修复：成功建立中继链路，网络恢复稳健.`, tick)
      }
    }
    lastConnectivity = currentConn

    // 4. 重大 QoS 报文预警
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
  }
})

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
    <div class="sandbox-label">TACTICAL OVERVIEW — 3D</div>
    <div class="camera-hint">🖱 拖拽旋转 | Shift+拖拽平移 | 滚轮缩放 | 点击无人机查看详情</div>

    <!-- Sandbox Terminal Logger -->
    <div class="sandbox-terminal">
      <div class="terminal-header">
        <span class="terminal-title">WNO_SYS_TERMINAL_V6.0</span>
        <span class="terminal-dots">...</span>
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
            background: ['#00f2ff','#a855f7','#00ff88'][hoverInfo.uav.channel] || '#00f2ff',
            color: '#040714'
          }">UAV-{{ String(hoverInfo.uav.id).padStart(2, '0') }}</span>
          <span class="tooltip-ch">CH{{ hoverInfo.uav.channel + 1 }}</span>
        </div>
        <div class="tooltip-row">
          <span>⚡ 电量</span>
          <span class="tooltip-val" :class="{ low: hoverInfo.uav.energy < 20 }">{{ hoverInfo.uav.energy.toFixed(0) }}%</span>
        </div>
        <div class="tooltip-row">
          <span>📡 状态</span>
          <span class="tooltip-val" :class="{
            conflict: hoverInfo.uav.is_conflict,
            nlos: hoverInfo.uav.is_nlos && !hoverInfo.uav.is_conflict
          }">{{ hoverInfo.uav.is_conflict ? '同频冲突' : (hoverInfo.uav.is_nlos ? 'NLOS遮挡' : '正常') }}</span>
        </div>
        <div class="tooltip-row">
          <span>📍 坐标</span>
          <span class="tooltip-val">{{ hoverInfo.uav.x.toFixed(0) }}, {{ hoverInfo.uav.y.toFixed(0) }}</span>
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
  color: rgba(0, 242, 255, 0.4);
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
  color: rgba(0, 242, 255, 0.25);
  pointer-events: none;
  z-index: 10;
}

/* Terminal Overlay Styles */
.sandbox-terminal {
  position: absolute;
  bottom: 24px;
  right: 24px;
  width: 480px;
  max-height: 240px;
  display: flex;
  flex-direction: column;
  background: rgba(4, 7, 20, 0.75);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(0, 242, 255, 0.15);
  border-radius: 6px;
  z-index: 20;
  box-shadow: 0 4px 24px rgba(0,0,0,0.6);
  pointer-events: auto;
}

.terminal-header {
  padding: 4px 10px;
  background: rgba(0, 242, 255, 0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(0, 242, 255, 0.2);
}

.terminal-title {
  font-family: var(--font-mono);
  font-size: 10px;
  color: #00f2ff;
  letter-spacing: 1px;
}

.terminal-dots {
  color: #00f2ff;
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
  background: rgba(0, 242, 255, 0.3);
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
  color: #64748b;
  flex-shrink: 0;
}

.log-level {
  font-weight: bold;
  flex-shrink: 0;
  min-width: 80px;
}

.log-level.system { color: #a855f7; }
.log-level.env { color: #00ff88; }
.log-level.swarm { color: #00f2ff; }
.log-level.ai { color: #facc15; }
.log-level.aicore { color: #facc15; }
.log-level.network { color: #ff3b3b; }
.log-level.qos { color: #ffaa00; }

.log-msg {
  flex: 1;
}

.log-msg.warning { color: #ffaa00; }
.log-msg.danger { color: #ff3b3b; text-shadow: 0 0 6px rgba(255,59,59,0.5); font-weight: bold; }
.log-msg.success { color: #00ff88; text-shadow: 0 0 6px rgba(0,255,136,0.3); }
</style>

<style>
/* Global (unscoped) styles for the hover tooltip teleported to body */
.uav-hover-tooltip {
  position: fixed;
  z-index: 10000;
  pointer-events: none;
  background: rgba(4, 7, 20, 0.92);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(0, 242, 255, 0.2);
  border-radius: 8px;
  padding: 10px 14px;
  min-width: 160px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 20px rgba(0, 242, 255, 0.1);
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
  border-bottom: 1px solid rgba(0, 242, 255, 0.1);
}

.tooltip-id {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
}

.tooltip-ch {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: #94a3b8;
}

.tooltip-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #94a3b8;
  padding: 2px 0;
  font-family: 'Noto Sans SC', sans-serif;
}

.tooltip-val {
  font-family: 'JetBrains Mono', monospace;
  color: #e2e8f0;
  font-weight: 500;
}

.tooltip-val.conflict {
  color: #ff3b3b;
  text-shadow: 0 0 6px rgba(255, 59, 59, 0.5);
}

.tooltip-val.nlos {
  color: #ffaa00;
}

.tooltip-val.low {
  color: #ff3b3b;
}
</style>

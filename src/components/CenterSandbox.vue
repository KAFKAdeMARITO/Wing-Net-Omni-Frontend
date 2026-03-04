<script setup lang="ts">
import { ref, inject, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import type { UAVNode, BuildingBlock } from '../types'
import { activeScene, sceneVersion } from '../composables/useScene'

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

  // Rebuildable scene objects
  sceneGroup = new THREE.Group()
  scene.add(sceneGroup)
  rebuildSceneObjects()

  // Groups for dynamic objects
  linkLines = new THREE.Group()
  scene.add(linkLines)
  trailGroup = new THREE.Group()
  scene.add(trailGroup)

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
    // Scale slightly larger to prevent z-fighting
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

  // Interference Sphere (Hidden by default, radius 40 = 80m diameter threshold)
  const sphereGeo = new THREE.SphereGeometry(40, 32, 32)
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

  group.userData.uavId = uav.id
  group.userData.interferenceMeshes = [intSphere, intCore]
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

    // Rotate propellers
    mesh.children.forEach((child) => {
      if ((child as THREE.Mesh).userData?.isPropeller) {
        (child as THREE.Mesh).rotation.z = time * 15 + uav.id
      }
    })

    // Slight body tilt based on movement
    mesh.rotation.z = Math.sin(time + uav.id) * 0.05
    mesh.rotation.x = Math.cos(time * 0.7 + uav.id) * 0.03

    // Update Flight Trails
    if (!uavTrails.has(uav.id)) uavTrails.set(uav.id, [])
    const trail = uavTrails.get(uav.id)!
    // Add current position to trail
    trail.push(new THREE.Vector3(pos.x, pos.y, pos.z))
    if (trail.length > 25) trail.shift() // keep last 25 frames

    let line = trailLines.get(uav.id)
    if (!line) {
      const geo = new THREE.BufferGeometry().setFromPoints(trail)
      const mat = new THREE.LineBasicMaterial({
        color: channelHexStr[uav.channel] || 0x00f2ff,
        transparent: true,
        opacity: 0.6,
        linewidth: 2
      })
      line = new THREE.Line(geo, mat)
      trailLines.set(uav.id, line)
      trailGroup.add(line)
    } else {
      line.geometry.setFromPoints(trail)
      // Fade out line if UAV is gone
      line.visible = true
    }
  }

  // Cleanup old trails for UAVs that no longer exist
  for (const [id, line] of trailLines.entries()) {
    if (!uavs.find(u => u.id === id)) {
      trailGroup.remove(line)
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
      trailLines.delete(id)
      uavTrails.delete(id)
    }
  }
}

function updateLinks() {
  // Clear old links and data flow points
  while (linkLines.children.length > 0) {
    const child = linkLines.children[0]
    linkLines.remove(child)
    if ((child as THREE.Object3D & { geometry?: THREE.BufferGeometry }).geometry) {
      (child as THREE.Object3D & { geometry?: THREE.BufferGeometry }).geometry!.dispose()
    }
  }

  if (!frame.value || !frame.value.uav_nodes) return
  const uavs: UAVNode[] = frame.value.uav_nodes
  const time = clock.getElapsedTime()

  for (let i = 0; i < uavs.length; i++) {
    for (let j = i + 1; j < uavs.length; j++) {
      const a = uavs[i], b = uavs[j]
      const dx = a.x - b.x, dy = a.y - b.y
      if (Math.sqrt(dx * dx + dy * dy) > 120) continue

      const posA = interpPositions.get(a.id) || { x: a.x, y: 40, z: a.y }
      const posB = interpPositions.get(b.id) || { x: b.x, y: 40, z: b.y }

      const points = [
        new THREE.Vector3(posA.x, posA.y, posA.z),
        new THREE.Vector3(posB.x, posB.y, posB.z),
      ]
      const geo = new THREE.BufferGeometry().setFromPoints(points)

      let color = 0x00f2ff
      let opacity = 0.15
      let lineWidth = 1

      if (a.is_conflict || b.is_conflict) {
        color = 0xff3b3b
        opacity = 0.4 + Math.sin(time * 10) * 0.3
      } else {
        // 动态 NLOS 检测：使用 activeScene 的建筑物实时判断
        const aNlos = checkNLOSDynamic(a.x, a.y)
        const bNlos = checkNLOSDynamic(b.x, b.y)
        if (aNlos || bNlos) {
          color = 0xffaa00
          opacity = 0.3
        }
      }

      const mat = new THREE.LineBasicMaterial({
        color, transparent: true, opacity,
      })
      const line = new THREE.Line(geo, mat)
      linkLines.add(line)

      // --- Add Data Flow Animation ---
      // We create a few points moving along the line from A to B (or B to a based on ID)
      if (opacity > 0) {
        // Decide direction based on ID to make it consistent
        const dir = b.id > a.id ? 1 : -1
        const speed = (a.is_conflict || b.is_conflict) ? 0.5 : 2.5 // slower if conflict
        
        // Calculate 3 moving points along the segment
        const flowPoints = []
        for (let k = 0; k < 3; k++) {
          const t = (time * speed + k * 0.33) % 1.0
          // If dir is -1, swap t direction
          const actualT = dir === 1 ? t : 1 - t
          
          const px = posA.x + (posB.x - posA.x) * actualT
          const py = posA.y + (posB.y - posA.y) * actualT
          const pz = posA.z + (posB.z - posA.z) * actualT
          flowPoints.push(new THREE.Vector3(px, py, pz))
        }
        
        const flowGeo = new THREE.BufferGeometry().setFromPoints(flowPoints)
        const flowMat = new THREE.PointsMaterial({
          color: color,
          size: 1.5,
          transparent: true,
          opacity: 0.8,
          sizeAttenuation: true
        })
        const flowMesh = new THREE.Points(flowGeo, flowMat)
        linkLines.add(flowMesh)
      }
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
  if (!isDragging) return
  const dx = e.clientX - prevMouse.x
  const dy = e.clientY - prevMouse.y
  prevMouse = { x: e.clientX, y: e.clientY }

  if (e.shiftKey || e.buttons === 4) {
    // Pan
    const right = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    camera.getWorldDirection(right)
    right.cross(up).normalize()
    cameraTarget.addScaledVector(right, -dx * 0.5)
    cameraTarget.y += dy * 0.5
  } else {
    // Orbit
    cameraAngle.theta -= dx * 0.005
    cameraAngle.phi = Math.max(0.1, Math.min(Math.PI * 0.45, cameraAngle.phi + dy * 0.005))
  }
  updateCameraPosition()
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
  if (!frame.value) return
  const rect = renderer.domElement.getBoundingClientRect()
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(mouse, camera)
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
  updateUAVs()
  updateLinks()
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
}

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
    <div class="camera-hint">🖱 拖拽旋转 | Shift+拖拽平移 | 滚轮缩放</div>
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
</style>

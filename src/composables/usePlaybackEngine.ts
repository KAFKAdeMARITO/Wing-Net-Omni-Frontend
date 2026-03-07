/**
 * 帧回放引擎 Playback Engine
 * 管理 tick 推进、播放控制、帧数据分发
 */
import { ref, computed, shallowRef, watch } from 'vue'
import { FrameData } from '../types'
import { activeScene, simulationStrategy } from './useScene'

const frames = shallowRef<FrameData[]>([])
const currentTick = ref(0)
const isPlaying = ref(false)
const playbackSpeed = ref(1)
const _animFrameId = ref(0)
let lastTime = 0
const tickInterval = 100  // ms per tick at 1x

// --- Optimization Cache ---
const frameCache = new Map<number, FrameData>()
// Clear cache when frames or strategy changes
function clearFrameCache() { frameCache.clear() }
watch([frames, simulationStrategy], clearFrameCache)

function checkNLOSDynamic(x: number, y: number): boolean {
    for (const b of activeScene.buildings) {
        const dx = x - (b.x + b.width / 2)
        const dy = y - (b.y + b.depth / 2)
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < (b.width + b.depth) / 2 + 15) return true
    }
    return false
}

// 检测无人机是否在干扰圈内
function checkInterferenceZone(x: number, y: number): { inZone: boolean; strength: number } {
    for (const z of activeScene.interferenceZones) {
        const dx = x - z.x, dy = y - z.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < z.radius) return { inZone: true, strength: z.strength }
    }
    return { inZone: false, strength: 0 }
}

// 动态应用由 activeScene 控制的实时遮挡状态到历史/预先生成的帧中
function applyDynamicSceneToFrame(frame: FrameData, tickIndex?: number): FrameData {
    // Check cache first
    if (tickIndex !== undefined && frameCache.has(tickIndex)) {
        return frameCache.get(tickIndex)!
    }

    const uavs = frame.uav_nodes
    const numUavs = uavs.length

    // 1. Detect dynamic co-channel interference
    const conflictIds = new Set<number>()
    // Pre-extract building data for faster loop
    const buildings = activeScene.buildings
    const zones = activeScene.interferenceZones

    for (let i = 0; i < numUavs; i++) {
        const a = uavs[i]
        for (let j = i + 1; j < numUavs; j++) {
            const b = uavs[j]
            if (a.channel === b.channel) {
                const dx = a.x - b.x
                const dy = a.y - b.y
                const dz = (a.z || 30) - (b.z || 30)
                if (dx * dx + dy * dy + dz * dz < 1225) { // 35^2
                    conflictIds.add(a.id)
                    conflictIds.add(b.id)
                }
            }
        }
    }

    const patchedUavs = uavs.map(uav => {
        // inline checkNLOS
        let isNlos = false
        for (let i = 0; i < buildings.length; i++) {
            const b = buildings[i]
            const dx = uav.x - (b.x + b.width / 2)
            const dy = uav.y - (b.y + b.depth / 2)
            if (dx * dx + dy * dy < Math.pow((b.width + b.depth) / 2 + 15, 2)) {
                isNlos = true; break
            }
        }

        const isConflict = conflictIds.has(uav.id)

        // inline checkInterferenceZone
        let isInZone = false, strength = 0
        for (let i = 0; i < zones.length; i++) {
            const z = zones[i]
            const dx = uav.x - z.x, dy = uav.y - z.y
            if (dx * dx + dy * dy < z.radius * z.radius) {
                isInZone = true; strength = z.strength; break
            }
        }

        let pdr = uav.pdr || 0.95
        let delay = uav.delay || 15
        let throughput = uav.throughput || 100
        let interference = 0
        let power = 20

        if (isConflict) {
            interference = 0.8 + (uav.id % 5) * 0.04
            if (simulationStrategy.value === 'dynamic') {
                pdr = 0.90 + (uav.id % 5) * 0.01
                delay = 18 + (uav.id % 5)
                throughput = 95 + (uav.id % 10)
                power = 24 + (uav.id % 3)
            } else {
                pdr = 0.65 + (uav.id % 5) * 0.02
                delay = 45 + (uav.id % 15)
                throughput = 50 + (uav.id % 20)
                power = 20
            }
        } else if (isInZone) {
            interference = strength
            if (simulationStrategy.value === 'dynamic') {
                pdr = (0.95 + (uav.id % 4) * 0.01) * (1 - strength * 0.05)
                delay = (10 + (uav.id % 5)) * (1 + strength * 0.2)
                throughput = (120 + (uav.id % 20)) * (1 - strength * 0.1)
                power = 22 + (strength * 5)
            } else {
                pdr = (0.93 + (uav.id % 6) * 0.01) * (1 - strength * 0.3)
                delay = (8 + (uav.id % 10)) * (1 + strength * 0.8)
                throughput = (110 + (uav.id % 40)) * (1 - strength * 0.5)
                power = 20
            }
        } else if (isNlos) {
            interference = 0.4 + (uav.id % 5) * 0.02
            power = simulationStrategy.value === 'dynamic' ? 26 : 20
            pdr = 0.82 + (uav.id % 10) * 0.01
            delay = 25 + (uav.id % 15)
            throughput = 80 + (uav.id % 30)
        } else {
            interference = 0.02 + (uav.id % 5) * 0.01
            power = 20
            pdr = 0.93 + (uav.id % 6) * 0.01
            delay = 8 + (uav.id % 10)
            throughput = 110 + (uav.id % 40)
        }

        // inline neighbors loop
        let neighbors = 0
        for (let i = 0; i < numUavs; i++) {
            const other = uavs[i]
            if (other.id === uav.id) continue
            const dx = uav.x - other.x, dy = uav.y - other.y, dz = (uav.z || 30) - (other.z || 30)
            if (dx * dx + dy * dy + dz * dz < 10000) neighbors++
        }

        return {
            ...uav,
            is_nlos: isNlos,
            is_conflict: isConflict,
            is_in_zone: isInZone,
            pdr: Math.round(pdr * 1000) / 1000,
            delay: Math.round(delay * 10) / 10,
            throughput: Math.round(throughput * 10) / 10,
            interference: Math.round(interference * 100) / 100,
            power: Math.round(power * 10) / 10,
            neighbors
        }
    })

    const res = {
        ...frame,
        uav_nodes: patchedUavs,
        conflicts: conflictIds.size / 2,
        QoS: {
            ...frame.QoS,
            total_pdr: Math.round(patchedUavs.reduce((s, u) => s + (u.pdr || 0), 0) / numUavs * 1000) / 1000,
            p99_latency_ms: Math.round(patchedUavs.reduce((s, u) => s + (u.delay || 0), 0) / numUavs * 1.5 * 10) / 10,
            throughput_mbps: Math.round(patchedUavs.reduce((s, u) => s + (u.throughput || 0), 0) / numUavs * 10) / 10
        }
    }

    if (tickIndex !== undefined) frameCache.set(tickIndex, res)
    return res
}

export function usePlaybackEngine() {
    const currentFrame = computed<FrameData | null>(() => {
        const idx = currentTick.value
        const rawFrame = frames.value[idx] || null
        if (!rawFrame) return null;
        return applyDynamicSceneToFrame(rawFrame, idx)
    })

    const totalTicks = computed(() => frames.value.length)
    const progress = computed(() => totalTicks.value > 0 ? currentTick.value / (totalTicks.value - 1) : 0)

    function loadFrames(data: FrameData[]) {
        frames.value = data
        currentTick.value = 0
    }

    function play() {
        if (frames.value.length === 0) return
        isPlaying.value = true
        lastTime = performance.now()
        tick()
    }

    function pause() {
        isPlaying.value = false
        if (_animFrameId.value) {
            cancelAnimationFrame(_animFrameId.value)
            _animFrameId.value = 0
        }
    }

    function togglePlay() {
        if (isPlaying.value) pause()
        else play()
    }

    function seek(tickNum: number) {
        currentTick.value = Math.max(0, Math.min(tickNum, frames.value.length - 1))
    }

    function setSpeed(speed: number) {
        playbackSpeed.value = speed
    }

    function tick() {
        if (!isPlaying.value) return
        const now = performance.now()
        const delta = now - lastTime

        if (delta >= tickInterval / playbackSpeed.value) {
            lastTime = now
            if (currentTick.value < frames.value.length - 1) {
                currentTick.value++
            } else {
                // Loop back
                currentTick.value = 0
            }
        }

        _animFrameId.value = requestAnimationFrame(tick)
    }

    /** 获取前N帧历史用于折线图，同样应用实时场景判定 */
    function getHistory(count: number): FrameData[] {
        const currentIdx = currentTick.value
        const start = Math.max(0, currentIdx - count + 1)
        const hist: FrameData[] = []
        for (let i = start; i <= currentIdx; i++) {
            const f = frames.value[i]
            if (f) hist.push(applyDynamicSceneToFrame(f, i))
        }
        return hist
    }

    return {
        frames,
        currentFrame,
        currentTick,
        totalTicks,
        progress,
        isPlaying,
        playbackSpeed,
        loadFrames,
        play,
        pause,
        togglePlay,
        seek,
        setSpeed,
        getHistory
    }
}

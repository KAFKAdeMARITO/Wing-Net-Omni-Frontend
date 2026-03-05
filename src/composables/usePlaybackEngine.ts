/**
 * 帧回放引擎 Playback Engine
 * 管理 tick 推进、播放控制、帧数据分发
 */
import { ref, computed, shallowRef } from 'vue'
import type { FrameData } from '../types'
import { activeScene } from './useScene'

const frames = shallowRef<FrameData[]>([])
const currentTick = ref(0)
const isPlaying = ref(false)
const playbackSpeed = ref(1)
const _animFrameId = ref(0)
let lastTime = 0
const tickInterval = 100  // ms per tick at 1x

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
function applyDynamicSceneToFrame(frame: FrameData): FrameData {
    // 1. Detect dynamic co-channel interference (distance < 80m && same channel)
    const conflictIds = new Set<number>()
    for (let i = 0; i < frame.uav_nodes.length; i++) {
        for (let j = i + 1; j < frame.uav_nodes.length; j++) {
            const a = frame.uav_nodes[i]
            const b = frame.uav_nodes[j]
            // Same channel check
            if (a.channel === b.channel) {
                const dx = a.x - b.x
                const dy = a.y - b.y
                const dz = (a.z || 30) - (b.z || 30)
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
                if (dist < 80) { // Interference range
                    conflictIds.add(a.id)
                    conflictIds.add(b.id)
                }
            }
        }
    }

    const patchedUavs = frame.uav_nodes.map(uav => {
        const isNlos = checkNLOSDynamic(uav.x, uav.y)
        const isConflict = conflictIds.has(uav.id)
        const zoneCheck = checkInterferenceZone(uav.x, uav.y)
        const isInZone = zoneCheck.inZone

        let pdr = uav.pdr || 0.95
        let delay = uav.delay || 15
        let throughput = uav.throughput || 100

        if (isConflict) {
            // 同频干扰：PDR急剧下降，时延激增
            pdr = 0.65 + (uav.id % 5) * 0.02
            delay = 45 + (uav.id % 15)
            throughput = 50 + (uav.id % 20)
        } else if (isInZone) {
            // 干扰圈内：按强度施加惩罚
            const s = zoneCheck.strength
            pdr = (0.93 + (uav.id % 6) * 0.01) * (1 - s * 0.3)
            delay = (8 + (uav.id % 10)) * (1 + s * 0.8)
            throughput = (110 + (uav.id % 40)) * (1 - s * 0.5)
        } else if (isNlos) {
            // 物理遮挡：中度损失
            pdr = 0.82 + (uav.id % 10) * 0.01
            delay = 25 + (uav.id % 15)
            throughput = 80 + (uav.id % 30)
        } else {
            // 视距健康
            pdr = 0.93 + (uav.id % 6) * 0.01
            delay = 8 + (uav.id % 10)
            throughput = 110 + (uav.id % 40)
        }

        return {
            ...uav,
            is_nlos: isNlos,
            is_conflict: isConflict,
            is_in_zone: isInZone,
            pdr: Math.round(pdr * 1000) / 1000,
            delay: Math.round(delay * 10) / 10,
            throughput: Math.round(throughput * 10) / 10
        }
    })

    // 重新计算受场景影响的全局聚合 QoS
    const num = patchedUavs.length
    if (num === 0) return frame;

    const avgPdr = patchedUavs.reduce((s, u) => s + (u.pdr || 0), 0) / num
    const avgDelay = patchedUavs.reduce((s, u) => s + (u.delay || 0), 0) / num
    const avgThroughput = patchedUavs.reduce((s, u) => s + (u.throughput || 0), 0) / num

    return {
        ...frame,
        uav_nodes: patchedUavs,
        conflicts: conflictIds.size / 2, // Approximate conflict pairs
        QoS: {
            ...frame.QoS,
            total_pdr: Math.round(avgPdr * 1000) / 1000,
            p99_latency_ms: Math.round(avgDelay * 1.5 * 10) / 10,
            throughput_mbps: Math.round(avgThroughput * 10) / 10
        }
    }
}

export function usePlaybackEngine() {
    const currentFrame = computed<FrameData | null>(() => {
        const rawFrame = frames.value[currentTick.value] || null
        if (!rawFrame) return null;
        return applyDynamicSceneToFrame(rawFrame)
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
        const start = Math.max(0, currentTick.value - count + 1)
        return frames.value.slice(start, currentTick.value + 1).map(applyDynamicSceneToFrame)
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

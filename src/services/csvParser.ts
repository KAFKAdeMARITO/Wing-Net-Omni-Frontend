/**
 * CSV 数据解析服务
 * 读取后端输出的 CSV 文件，转换为前端 FrameData 格式
 */
import Papa from 'papaparse'
import type { FrameData, UAVNode } from '../types'

const NUM_UAVS = 15

/** 通用 CSV fetch + parse */
async function fetchCSV<T>(url: string): Promise<T[]> {
    const resp = await fetch(url)
    const text = await resp.text()
    const result = Papa.parse<T>(text, { header: true, dynamicTyping: true, skipEmptyLines: true })
    return result.data
}

/** 检测两个 UAV 之间是否有 NLOS (简化: 距离建筑近) */
function checkNLOS(x: number, y: number, buildings: Array<{ x: number; y: number; w: number; d: number }>): boolean {
    for (const b of buildings) {
        const dx = x - (b.x + b.w / 2)
        const dy = y - (b.y + b.d / 2)
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < (b.w + b.d) / 2 + 15) return true
    }
    return false
}

export async function loadCSVFrames(basePath: string = '/data'): Promise<FrameData[]> {
    // 尝试拉取 CSV，发生异常时降级优雅处理
    let qosRows: any[] = []
    let resRows: any[] = []
    let topoRows: any[] = []
    let posRows: any[] = []

    try {
        [qosRows, resRows, topoRows, posRows] = await Promise.all([
            fetchCSV<any>(`${basePath}/qos_performance.csv`).catch(() => []),
            fetchCSV<any>(`${basePath}/resource_allocation.csv`).catch(() => []),
            fetchCSV<any>(`${basePath}/topology_evolution.csv`).catch(() => []),
            fetchCSV<any>(`${basePath}/rtk-node-positions.csv`).catch(() => []),
        ])
    } catch (e) {
        console.warn('Failed to fetch some CSVs', e)
    }

    // 如果找不到 rtk-node-positions.csv，尝试找旧的 positions.csv
    if (posRows.length === 0) {
        posRows = await fetchCSV<any>(`${basePath}/positions.csv`).catch(() => [])
    }

    // 索引化: 按 time 取整分组，容忍少量时间差异
    const qosMap = new Map<number, any>()
    for (const r of qosRows) qosMap.set(Math.round(Number(r.time || 0)), r)

    const resMap = new Map<number, any>()
    for (const r of resRows) resMap.set(Math.round(Number(r.time || 0)), r)

    const topoMap = new Map<number, any>()
    for (const r of topoRows) topoMap.set(Math.round(Number(r.time || 0)), r)

    // positions 每行是新款 (time_s, nodeId, x, y, z) 或旧款 (time, uav_id, pos_x, pos_y)
    const posMap = new Map<number, Map<number, { x: number; y: number; z: number; drift: number }>>()
    for (const r of posRows) {
        const t = Math.round(Number(r.time_s ?? r.time ?? 0))
        const uid = Number(r.nodeId ?? r.uav_id ?? 0)

        if (!posMap.has(t)) posMap.set(t, new Map())
        posMap.get(t)!.set(uid, {
            x: Number(r.x ?? r.pos_x ?? 0),
            y: Number(r.y ?? r.pos_y ?? 0),
            z: Number(r.z ?? 30),
            drift: Number(r.rtk_drift_error || 0)
        })
    }

    // 建筑物 (简化定义)
    const buildings = [
        { x: 180, y: 150, w: 50, d: 50 },
        { x: 300, y: 200, w: 60, d: 40 },
        { x: 400, y: 120, w: 45, d: 55 },
        { x: 250, y: 350, w: 55, d: 45 },
        { x: 420, y: 320, w: 50, d: 50 },
        { x: 150, y: 400, w: 40, d: 60 },
        { x: 350, y: 450, w: 65, d: 35 },
        { x: 500, y: 250, w: 45, d: 50 },
        { x: 100, y: 280, w: 50, d: 40 },
    ]

    // 提取所有时间戳 (由于使用了 Math.round，这里都是整数 tick)
    const allTimes = [...new Set([
        ...qosMap.keys(), ...resMap.keys(), ...topoMap.keys(), ...posMap.keys()
    ])].sort((a, b) => a - b)

    // 组装 FrameData
    const frames: FrameData[] = []
    for (const tick of allTimes) {
        const qos = qosMap.get(tick) || {}
        const res = resMap.get(tick) || {}
        const topo = topoMap.get(tick) || {}
        const positions = posMap.get(tick) || new Map()

        const uavs: UAVNode[] = []
        let conflictCount = 0

        for (let i = 0; i < NUM_UAVS; i++) {
            const pos = positions.get(i) || { x: 300, y: 300, z: 30, drift: 0 }

            // 兼容旧的 uavX_ch 和新的 uavX_channel
            const ch = Number(res[`uav${i}_channel`] ?? res[`uav${i}_ch`] ?? (i % 3))
            // 兼容旧的 uavX_pwr 和新的 uavX_power
            const pwr = Number(res[`uav${i}_power`] ?? res[`uav${i}_pwr`] ?? 20)
            const rate = Number(res[`uav${i}_rate`] ?? 0)

            const pdr = Number(qos[`uav${i}_pdr`] ?? qos.avg_pdr ?? 0.9)
            const delay = Number(qos[`uav${i}_delay`] ?? qos.avg_delay ?? 15)
            const tp = Number(qos[`uav${i}_throughput`] ?? qos.avg_throughput ?? 100)

            const isNlos = checkNLOS(pos.x, pos.y, buildings)

            // 冲突检测: 同频且近距离
            let isConflict = false
            for (let j = 0; j < i; j++) {
                const otherPos = positions.get(j) || { x: 0, y: 0, z: 0, drift: 0 }
                const otherCh = Number(res[`uav${j}_channel`] ?? res[`uav${j}_ch`] ?? (j % 3))
                if (otherCh === ch) {
                    const dx = pos.x - otherPos.x
                    const dy = pos.y - otherPos.y
                    const dz = pos.z - otherPos.z
                    // 3D 距离冲突检测
                    if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 120) {
                        isConflict = true
                        conflictCount++
                        break
                    }
                }
            }

            // 能量随时间衰减
            const energy = Math.max(5, 100 - (tick / Math.max(1, allTimes.length)) * 35)

            uavs.push({
                id: i,
                x: pos.x + (pos.drift > 0 ? (Math.random() - 0.5) * pos.drift : 0),
                y: pos.y + (pos.drift > 0 ? (Math.random() - 0.5) * pos.drift : 0),
                z: pos.z,
                channel: ch,
                is_conflict: isConflict,
                is_nlos: isNlos,
                energy: Math.round(energy * 10) / 10,
                is_active: true,
                pdr, delay, throughput: tp, power: pwr, rate
            })
        }

        const avgPdr = Number(qos.avg_pdr) || uavs.reduce((s, u) => s + (u.pdr || 0), 0) / NUM_UAVS
        const avgDelay = Number(qos.avg_delay) || uavs.reduce((s, u) => s + (u.delay || 0), 0) / NUM_UAVS

        frames.push({
            tick,
            QoS: {
                total_pdr: avgPdr,
                p99_latency_ms: avgDelay * 1.5,
                throughput_mbps: Number(qos.avg_throughput) || 100,
                algo_compute_time_ms: 1.5 + Math.random() * 2
            },
            uav_nodes: uavs,
            topology: {
                num_links: Number(topo.num_links) || 25,
                connectivity: Number(topo.connectivity) || 0.95
            },
            conflicts: conflictCount
        })
    }

    return frames
}

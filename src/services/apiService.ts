import type { BuildingBlock, FrameData, UAVNode } from '../types'
import type { FormationType } from '../data/mockData'
import { loadCSVFrames } from './csvParser'

export interface SimulationConfig {
    buildings: BuildingBlock[]
    swarm_size: number
    formation: FormationType
    difficulty: 'Easy' | 'Moderate' | 'Hard'
    strategy: 'static' | 'dynamic'
    start?: string
    target?: string
}

const BASE_URL = 'http://localhost:5000';

/**
 * Parses the raw JSON response from the backend into a FrameData array 
 * matching what the frontend expects.
 */
function parseBackendJSONToFrames(payload: any, swarmSize: number): FrameData[] {
    const frames: FrameData[] = [];
    const positions = payload.positions || [];
    const qos = payload.qos || [];
    const topo = payload.topology_evolution || [];
    const backendTransmissions = payload.transmissions || [];
    const backendLinks = payload.topology_links || [];

    // Map data by time segment
    const timeMap = new Map<number, any>();

    // Process QoS
    for (const q of qos) {
        const t = q.time;
        if (!timeMap.has(t)) timeMap.set(t, { qos: q, positions: new Map(), num_links: 0, connectivity: 0 });
        else timeMap.get(t).qos = q;
    }

    // Process Topology Evolution
    for (const tp of topo) {
        const t = tp.time;
        if (!timeMap.has(t)) timeMap.set(t, { qos: {}, positions: new Map(), num_links: tp.num_links, connectivity: tp.connectivity });
        else {
            timeMap.get(t).num_links = tp.num_links;
            timeMap.get(t).connectivity = tp.connectivity;
        }
    }

    // Process Positions
    for (const p of positions) {
        const t = p.time;
        if (!timeMap.has(t)) {
            timeMap.set(t, { qos: {}, positions: new Map(), num_links: 0, connectivity: 0 });
        }
        timeMap.get(t).positions.set(p.nodeId, p);
    }

    const allTimes = Array.from(timeMap.keys()).sort((a, b) => a - b);

    for (const tick of allTimes) {
        const data = timeMap.get(tick);
        const qosData = data.qos;
        const posMap = data.positions;

        const uavs: UAVNode[] = [];
        let totalPdrSum = 0;
        let totalDelaySum = 0;
        let totalTpSum = 0;

        for (let i = 0; i < swarmSize; i++) {
            const pos = posMap.get(i) || { x: 0, y: 0, z: 30 };
            const uPdr = qosData[`uav${i}_pdr`] ?? 0.9;
            const uDelay = qosData[`uav${i}_delay`] ?? 15;
            const uTp = qosData[`uav${i}_throughput`] ?? 100;

            totalPdrSum += uPdr;
            totalDelaySum += uDelay;
            totalTpSum += uTp;

            // Energy decays from 100 down to 20 based on tick progress
            const progress = allTimes.indexOf(tick) / Math.max(1, allTimes.length);
            const energy = Math.max(20, 100 - (progress * 80));

            uavs.push({
                id: i,
                x: pos.x,
                y: pos.y,
                z: pos.z,
                channel: i % 3, // Mock channel assignment for now if not provided
                is_conflict: false, // Calculated frontend side or backend side if available
                is_nlos: false, // Calculated frontend side or backend side if available
                energy: Math.round(energy),
                is_active: true,
                pdr: uPdr,
                delay: uDelay,
                throughput: uTp,
                power: 20,
                rate: 0
            });
        }

        frames.push({
            tick,
            QoS: {
                total_pdr: totalPdrSum / swarmSize,
                p99_latency_ms: (totalDelaySum / swarmSize) * 1.5,
                throughput_mbps: (totalTpSum / swarmSize),
                algo_compute_time_ms: 1.5 + Math.random() * 2
            },
            uav_nodes: uavs,
            topology: {
                num_links: data.num_links,
                connectivity: data.connectivity
            },
            conflicts: 0, // Placeholder
            links: backendLinks.find((l: any) => l.time === tick)?.links || [],
            transmissions: backendTransmissions.filter((tr: any) => tr.time === tick)
        } as any);
    }

    return frames;
}

/**
 * 模拟后端的 API 服务
 */
export const apiService = {
    /**
     * 发送配置并开始仿真
     * 实际部署时这里会替换为真正的 fetch / axios 调用
     */
    async startSimulation(config: SimulationConfig): Promise<FrameData[]> {
        console.log('[WingNet API] POST /api/simulate', JSON.stringify(config, null, 2))

        try {
            // 1. 发起仿真
            const startRes = await fetch(`${BASE_URL}/api/simulate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    num_drones: config.swarm_size,
                    formation: config.formation,
                    difficulty: config.difficulty,
                    strategy: config.strategy,
                    start: config.start || "0,0,30",
                    target: config.target || "0,600,30",
                    buildings: config.buildings.map(b => ({
                        xMin: b.x, xMax: b.x + b.width,
                        yMin: b.y, yMax: b.y + b.depth,
                        zMin: 0, zMax: b.height
                    }))
                })
            });

            if (!startRes.ok) {
                throw new Error(`Failed to start simulation: ${startRes.statusText}`);
            }

            const startData = await startRes.json();
            const taskId = startData.task_id;
            console.log(`[WingNet API] 仿真已在云端启动，任务 ID: ${taskId}`);

            // 2. 轮询结果 (每 3 秒)
            return new Promise((resolve, reject) => {
                const timer = setInterval(async () => {
                    try {
                        const pollRes = await fetch(`${BASE_URL}/api/results/${taskId}`);
                        if (!pollRes.ok) throw new Error('Failed to poll results');
                        const pollData = await pollRes.json();

                        if (pollData.status === 'SUCCESS') {
                            clearInterval(timer);
                            console.log("[WingNet API] 🎉 数据结算完成！");
                            console.log("[WingNet API] 👇 后端的 RAW JSON 数据 (包含 coordinates, qos, topology 等) 👇");
                            console.log(pollData.data);

                            const frames = parseBackendJSONToFrames(pollData.data, config.swarm_size);
                            resolve(frames);

                        } else if (pollData.status === 'FAILED') {
                            clearInterval(timer);
                            console.error("[WingNet API] ❌ 后端引擎推演崩溃了：", pollData.error);
                            reject(new Error("Server simulation failed: " + pollData.error));
                        } else {
                            console.log(`[WingNet API] 状态: ${pollData.status} (后端算力引擎正在轰鸣中...)`);
                        }
                    } catch (e) {
                        clearInterval(timer);
                        reject(e);
                    }
                }, 3000);
            });

        } catch (error) {
            console.error('[WingNet API] Error during simulation:', error);
            // Fallback to local csv parsing if backend is completely unreachable
            console.log("[WingNet API] 无法连接到后端，降级使用本地预设数据");
            const dataPath = '/data' // 默认为 public/data 下的演示数据
            const frames = await loadCSVFrames(dataPath)
            return frames
        }
    }
}

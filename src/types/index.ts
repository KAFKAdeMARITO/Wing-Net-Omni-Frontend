/* ── 数据类型定义 ── */

/** 单架无人机帧状态 */
export interface UAVNode {
    id: number
    x: number
    y: number
    z: number
    channel: number       // 0/1/2 → CH1/CH2/CH3
    is_conflict: boolean
    is_nlos: boolean
    energy: number        // 0-100
    is_active: boolean
    delay?: number
    pdr?: number
    throughput?: number
    power?: number        // dBm
    rate?: number
    is_in_zone?: boolean  // 是否在干扰圈内
    interference?: number // 当前遭遇的干扰强度
    neighbors?: number    // 邻居数量
}

/** 全局 QoS 指标 */
export interface QoSMetrics {
    total_pdr: number
    p99_latency_ms: number
    throughput_mbps: number
    algo_compute_time_ms: number
}

/** 一帧完整数据 */
export interface FrameData {
    tick: number
    QoS: QoSMetrics
    uav_nodes: UAVNode[]
    topology: {
        num_links: number
        connectivity: number
    }
    conflicts: number
    links?: string[]     // format: e.g. "Node0-Node1", or "0-1" depending on backend
    transmissions?: any[]
}

/** 建筑物障碍定义 */
export interface BuildingBlock {
    x: number
    y: number
    width: number
    depth: number
    height: number
}

/** 干扰圈定义 */
export interface InterferenceZone {
    x: number
    y: number
    radius: number
    strength: number
}

/** 场景配置 */
export interface SceneConfig {
    buildings: BuildingBlock[]
    interferenceZones: InterferenceZone[]
    gridSize: number
}

/** 科研雷达图指标 */
export interface BenchmarkMetrics {
    algorithm: string
    scenario: string
    formation: string
    throughput: number
    latency: number
    jitter: number
    pdr: number
    topology_stability: number
}

/** CSV Row Types */
export interface QoSRow {
    time: number
    avg_pdr: number
    avg_throughput: number
    avg_delay: number
    [key: string]: number   // uavX_pdr, uavX_delay, uavX_throughput
}

export interface ResourceRow {
    time: number
    [key: string]: number   // uavX_channel, uavX_power, uavX_rate
}

export interface TopologyRow {
    time: number
    num_links: number
    connectivity: number
}

export interface PositionRow {
    time_s: number
    nodeId: number
    x: number
    y: number
    z: number
}

export interface FlowStatRow {
    FlowId: number
    Src: number
    Dest: number
    Tx: number
    Rx: number
    LossRate: number
}

import type { BuildingBlock, FrameData } from '../types'
import type { FormationType } from '../data/mockData'
import { loadCSVFrames } from './csvParser'

export interface SimulationConfig {
    buildings: BuildingBlock[]
    swarm_size: number
    formation: FormationType
    difficulty: 'Easy' | 'Moderate' | 'Hard'
    strategy: 'static' | 'dynamic'
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
        console.log('[WingNet API] POST /api/simulation/run', JSON.stringify(config, null, 2))

        // 模拟网络请求和后端仿真耗时 (2秒)
        await new Promise(resolve => setTimeout(resolve, 2000))

        // 实际应用场景下，后端可以直接返回下载链接或流
        // 目前为了推进，我们退化到读取本地预先放置的演示数据
        const dataPath = '/data' // 默认为 public/data 下的演示数据

        console.log(`[WingNet API] 仿真完成，拉取结果数据: ${dataPath}`)
        const frames = await loadCSVFrames(dataPath)

        return frames
    }
}

<script setup lang="ts">
import type { UAVNode } from '../types'

const props = defineProps<{
  uav: UAVNode
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const channelLabels = ['CH1', 'CH2', 'CH3']
const channelColors = ['#00f2ff', '#a855f7', '#00ff88']
const channelColor = channelColors[props.uav.channel] || '#00f2ff'

const businessType = props.uav.id % 3 === 0 ? '高清图传' : (props.uav.id % 3 === 1 ? '日常控制' : '数据采集')

const statusText = props.uav.is_conflict ? '⚠ 同频冲突' : (props.uav.is_nlos ? '◎ NLOS 遮挡' : '● 正常运行')
const statusClass = props.uav.is_conflict ? 'danger' : (props.uav.is_nlos ? 'warn' : 'ok')
</script>

<template>
  <div class="uav-detail-overlay" @click.self="emit('close')">
    <div class="uav-detail glass-panel">
      <!-- Channel color accent bar -->
      <div class="detail-accent" :style="{ background: `linear-gradient(90deg, transparent, ${channelColor}, transparent)` }"></div>
      <div class="detail-header">
        <div class="detail-title">
          <span class="uav-badge" :style="{ background: channelColor, boxShadow: `0 0 12px ${channelColor}` }">
            UAV-{{ String(uav.id).padStart(2, '0') }}
          </span>
          <span class="detail-status" :class="statusClass">{{ statusText }}</span>
        </div>
        <button class="close-btn" @click="emit('close')">✕</button>
      </div>

      <div class="detail-grid">
        <div class="detail-item">
          <span class="stat-label">信道</span>
          <span class="stat-value" :style="{ color: channelColor }">{{ channelLabels[uav.channel] }}</span>
        </div>
        <div class="detail-item">
          <span class="stat-label">业务类型</span>
          <span class="stat-value" style="font-size: 14px;">{{ businessType }}</span>
        </div>
        <div class="detail-item">
          <span class="stat-label">坐标</span>
          <span class="stat-value" style="font-size: 14px;">{{ uav.x.toFixed(1) }}, {{ uav.y.toFixed(1) }}</span>
        </div>
        <div class="detail-item">
          <span class="stat-label">发射功率</span>
          <span class="stat-value" style="font-size: 14px;">{{ (uav.power || 20).toFixed(1) }} dBm</span>
        </div>
      </div>

      <!-- 电池 -->
      <div class="detail-battery">
        <span class="stat-label">电池健康</span>
        <div class="battery-bar-wrapper">
          <div class="battery-bar">
            <div class="battery-fill"
              :style="{
                width: uav.energy + '%',
                background: uav.energy > 50 ? 'var(--green)' : (uav.energy > 20 ? 'var(--orange)' : 'var(--red)')
              }"
            ></div>
          </div>
          <span class="battery-pct" :class="{ low: uav.energy < 20 }">{{ uav.energy.toFixed(1) }}%</span>
        </div>
      </div>

      <!-- 单机 QoS -->
      <div class="detail-qos">
        <div class="section-title">网络指标</div>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="stat-label">PDR</span>
            <span class="stat-value green" style="font-size: 16px;">{{ ((uav.pdr || 0) * 100).toFixed(1) }}%</span>
          </div>
          <div class="detail-item">
            <span class="stat-label">时延</span>
            <span class="stat-value" style="font-size: 16px;">{{ (uav.delay || 0).toFixed(1) }}ms</span>
          </div>
          <div class="detail-item">
            <span class="stat-label">吞吐量</span>
            <span class="stat-value" style="font-size: 16px;">{{ (uav.throughput || 0).toFixed(1) }} Mbps</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.uav-detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.uav-detail {
  width: 380px;
  padding: 24px;
  animation: slideUp 0.3s ease;
  position: relative;
  overflow: hidden;
}

.detail-accent {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.detail-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.uav-badge {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  color: var(--bg-deep);
  padding: 4px 12px;
  border-radius: var(--radius-sm);
}

.detail-status {
  font-family: var(--font-mono);
  font-size: 12px;
}

.detail-status.ok { color: var(--green); }
.detail-status.warn { color: var(--orange); }
.detail-status.danger { color: var(--red); animation: pulse-danger 1s infinite; }

.close-btn {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}

.close-btn:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.05);
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-battery {
  margin-bottom: 16px;
}

.battery-bar-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}

.battery-bar {
  flex: 1;
  height: 8px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  overflow: hidden;
}

.battery-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.5s ease;
  background-image: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 4px,
    rgba(255, 255, 255, 0.08) 4px,
    rgba(255, 255, 255, 0.08) 8px
  );
  background-size: 20px 20px;
  animation: battery-stripe 0.8s linear infinite;
}

.battery-pct {
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--green);
  min-width: 50px;
}

.battery-pct.low {
  color: var(--red);
  animation: pulse-danger 1.5s infinite;
}

.detail-qos {
  padding-top: 4px;
}
</style>

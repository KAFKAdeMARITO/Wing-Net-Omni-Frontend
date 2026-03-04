<script setup lang="ts">
import { inject, computed } from 'vue'

const engine = inject<any>('engine')
const currentTick = computed(() => engine?.currentTick?.value ?? 0)
const totalTicks = computed(() => engine?.totalTicks?.value ?? 1)
const isPlaying = computed(() => engine?.isPlaying?.value ?? false)
const speed = computed(() => engine?.playbackSpeed?.value ?? 1)
const progress = computed(() => totalTicks.value > 1 ? (currentTick.value / (totalTicks.value - 1)) * 100 : 0)

function onSeek(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value)
  engine?.seek(val)
}

function togglePlay() {
  engine?.togglePlay()
}

function setSpeed(s: number) {
  engine?.setSpeed(s)
}

const speeds = [0.5, 1, 2, 4]
</script>

<template>
  <div class="playback-bar glass-panel">
    <!-- Top accent glow line -->
    <div class="bar-accent"></div>

    <button class="pb-btn play-btn" :class="{ playing: isPlaying }" @click="togglePlay">
      <span v-if="isPlaying">⏸</span>
      <span v-else>▶</span>
    </button>

    <div class="pb-progress">
      <div class="pb-track">
        <div class="pb-fill" :style="{ width: progress + '%' }">
          <div class="pb-glow-dot"></div>
        </div>
      </div>
      <input
        type="range"
        class="pb-slider"
        min="0"
        :max="totalTicks - 1"
        :value="currentTick"
        @input="onSeek"
      />
    </div>

    <div class="pb-tick">
      <span class="pb-tick-label">TICK</span>
      <span class="pb-tick-value">{{ currentTick }} / {{ totalTicks - 1 }}</span>
    </div>

    <div class="pb-speed">
      <button
        v-for="s in speeds"
        :key="s"
        class="speed-btn"
        :class="{ active: speed === s }"
        @click="setSpeed(s)"
      >{{ s }}x</button>
    </div>
  </div>
</template>

<style scoped>
.playback-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 44px;
  padding: 0 20px;
  margin: 0 8px 8px;
  position: relative;
  overflow: hidden;
}

/* Top glow accent line */
.bar-accent {
  position: absolute;
  top: 0;
  left: 5%;
  right: 5%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--cyan), var(--purple), var(--cyan), transparent);
  opacity: 0.5;
}

.pb-btn {
  background: none;
  border: 1px solid var(--glass-border);
  color: var(--cyan);
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  transition: all var(--transition-fast);
}

.pb-btn:hover {
  background: var(--cyan-dim);
  box-shadow: var(--cyan-glow);
}

/* Breathing glow when playing */
.pb-btn.playing {
  animation: breathe-glow 2s ease-in-out infinite;
}

.pb-progress {
  flex: 1;
  position: relative;
  height: 20px;
  display: flex;
  align-items: center;
}

.pb-track {
  position: absolute;
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: visible;
}

.pb-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--cyan), var(--green));
  border-radius: 2px;
  transition: width 0.1s linear;
  box-shadow: 0 0 10px var(--cyan);
  position: relative;
}

/* Glowing dot at the end of progress */
.pb-glow-dot {
  position: absolute;
  right: -3px;
  top: 50%;
  transform: translateY(-50%);
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 8px var(--cyan), 0 0 16px var(--cyan);
}

.pb-slider {
  position: relative;
  width: 100%;
  height: 20px;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
  z-index: 1;
}

.pb-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--cyan);
  box-shadow: 0 0 8px var(--cyan);
  cursor: pointer;
}

.pb-tick {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 80px;
}

.pb-tick-label {
  font-family: var(--font-display);
  font-size: 8px;
  color: var(--text-dim);
  letter-spacing: 2px;
}

.pb-tick-value {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--cyan);
}

.pb-speed {
  display: flex;
  gap: 4px;
}

.speed-btn {
  background: none;
  border: 1px solid transparent;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.speed-btn:hover {
  color: var(--cyan);
  border-color: var(--glass-border);
}

.speed-btn.active {
  color: var(--cyan);
  background: var(--cyan-dim);
  border-color: var(--cyan);
}
</style>

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Droplet,
  Waves,
  RefreshCw,
  Play,
  Pause,
  Sliders,
  Volume2,
  VolumeX,
  Sparkles,
  CloudRain,
  Rotate3D,
  Info,
  HelpCircle,
  Activity,
  Trash2,
  Maximize2,
  Flame,
  ArrowDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { StonePreset, WaterTheme, Particle, WaveRecord, FallenStone } from './types';
import { playSplashSound, project3D } from './utils/physics';
import { initGrid, propagateWaves, addDisturbance, hexToRgb, clamp } from './utils/waveMath';

const GRID_SIZE = 64; // Grid dimensions (64x64 is fast, looks beautiful with bilinear scaling)

const STONE_PRESETS: StonePreset[] = [
  {
    id: 'pebble',
    name: '조약돌 (Pebble)',
    radius: 1.8,
    mass: 1.4,
    label: '소형 조약돌',
    sizeDesc: '지름 ~3cm',
    description: '작고 예리한 동심원이 수면 위를 빠르게 뒤흔듭니다.',
    icon: '🪨'
  },
  {
    id: 'stone',
    name: '조작 돌맹이 (Medium)',
    radius: 3.5,
    mass: 4.2,
    label: '보통 돌맹이',
    sizeDesc: '지름 ~10cm',
    description: '적당한 진폭과 넓은 주파수 대역의 활기찬 파동을 만듭니다.',
    icon: '💎'
  },
  {
    id: 'brick',
    name: '벽돌 조각 (Heavy)',
    radius: 5.5,
    mass: 9.0,
    label: '무거운 벽돌',
    sizeDesc: '지름 ~25cm',
    description: '수면 깊숙이 묵직한 힘과 높은 파고를 전달해 파동이 장시간 지속됩니다.',
    icon: '🧱'
  },
  {
    id: 'barricade',
    name: '거대 바위 (Meteor)',
    radius: 9.0,
    mass: 22.0,
    label: '거대 바위',
    sizeDesc: '지름 ~60cm',
    description: '강렬한 3D 수면 왜곡과 거대한 동적 충격 에너지를 수중 전체에 전파합니다.',
    icon: '🌋'
  }
];

const WATER_THEMES: WaterTheme[] = [
  {
    id: 'deep-ocean',
    name: 'Ocean Cyan (깊고 푸른 해양)',
    label: '심해',
    waterColor: '#0c3558',
    rippleColor: '#05192c',
    highlightColor: '#00ccff',
    bgColor: 'bg-slate-900',
    foamColor: '#e0f7ff'
  },
  {
    id: 'lagoon',
    name: 'Lagoon Emerald (열대 석호)',
    label: '에메랄드',
    waterColor: '#0e5f59',
    rippleColor: '#06302e',
    highlightColor: '#39f3bb',
    bgColor: 'bg-zinc-900',
    foamColor: '#d3fdf2'
  },
  {
    id: 'neon-bioluminescence',
    name: 'Bioluminescent Purple (심해 바이오네온)',
    label: '야광 바이오네온',
    waterColor: '#040d21',
    rippleColor: '#120220',
    highlightColor: '#cc00ff',
    bgColor: 'bg-black',
    foamColor: '#00ffd5'
  },
  {
    id: 'magma-pond',
    name: 'Liquid Magma (불타는 마그마)',
    label: '화산 용암',
    waterColor: '#420b00',
    rippleColor: '#1a0400',
    highlightColor: '#ff8800',
    bgColor: 'bg-stone-950',
    foamColor: '#ff4c00'
  }
];

export default function App() {
  // Config States
  const [selectedPresetId, setSelectedPresetId] = useState<string>('stone');
  const [dropHeight, setDropHeight] = useState<number>(3.0); // height in meters
  const [activeThemeId, setActiveThemeId] = useState<string>('deep-ocean');
  const [simMode, setSimMode] = useState<'throw' | 'rain' | 'oscillator'>('throw');
  
  // Speed, Damping, Tension configurations
  const [dampingVal, setDampingVal] = useState<number>(0.985); // viscosity factor
  const [wavesSpeed, setWavesSpeed] = useState<number>(1); // simulation substeps
  const [tensionVal, setTensionVal] = useState<number>(1.0); // wave speed scaler
  
  // Rain Settings
  const [rainIntensity, setRainIntensity] = useState<number>(0.15); // drops per frame

  // Oscillator (Signal Generator) Settings
  const [oscFrequency, setOscFrequency] = useState<number>(0.15); // oscillation speed
  const [oscAmplitude, setOscAmplitude] = useState<number>(8.0); // oscillation force

  // UI state
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [showExplanation, setShowExplanation] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  
  // 3D Grid Parameters
  const [yaw, setYaw] = useState<number>(-0.45); // horizontal angle
  const [pitch, setPitch] = useState<number>(0.75); // vertical angle
  const [zoom, setZoom] = useState<number>(0.95);
  const [showWavesStats, setShowWavesStats] = useState<boolean>(true);
  
  // Instant metrics updated during physics loop
  const [maxAmplitude, setMaxAmplitude] = useState<number>(0);
  const [lastImpactEnergy, setLastImpactEnergy] = useState<number>(0);
  const [lastImpactVelocity, setLastImpactVelocity] = useState<number>(0);
  const [activeStoneCount, setActiveStoneCount] = useState<number>(0);
  const [activeParticleCount, setActiveParticleCount] = useState<number>(0);

  // Canvas References
  const canvas2dRef = useRef<HTMLCanvasElement | null>(null);
  const canvas3dRef = useRef<HTMLCanvasElement | null>(null);
  const osciRef = useRef<HTMLCanvasElement | null>(null);

  // Simulation State Refs (prevents re-renders for 60fps loop stability)
  const stateRef = useRef({
    currentGrid: initGrid(GRID_SIZE),
    previousGrid: initGrid(GRID_SIZE),
    stones: [] as FallenStone[],
    particles: [] as Particle[],
    waveHistory: [] as number[],
    ticks: 0,
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
  });

  // Load custom offscreen canvas for liquid expansion scaling
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Initialize offscreen canvas once
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = GRID_SIZE;
      canvas.height = GRID_SIZE;
      offscreenCanvasRef.current = canvas;
    }
  }, []);

  const selectedPreset = STONE_PRESETS.find(p => p.id === selectedPresetId) || STONE_PRESETS[1];
  const activeTheme = WATER_THEMES.find(t => t.id === activeThemeId) || WATER_THEMES[0];

  // Helper: Trigger a stone splash spawn
  const triggerStoneSpawn = useCallback((gx: number, gy: number, customized?: { mass: number; radius: number; height: number }) => {
    const preset = STONE_PRESETS.find(p => p.id === selectedPresetId) || STONE_PRESETS[1];
    
    const stoneMass = customized ? customized.mass : preset.mass;
    const stoneRadius = customized ? customized.radius : preset.radius;
    const height = customized ? customized.height : dropHeight;

    // Free fall formula: v = sqrt(2 * g * h)
    const velocity = Math.sqrt(2 * 9.8 * height);
    // Kinetic energy: E = 0.5 * m * v^2 = m * g * h
    const ke = stoneMass * 9.8 * height;

    // Add falling stone to buffer
    const newStone: FallenStone = {
      id: Math.random().toString(),
      targetX: gx,
      targetY: gy,
      currentZ: height,
      initialZ: height,
      speed: 0.15 + (height * 0.02), // starting speed
      radius: stoneRadius,
      color: preset.id === 'meteor' ? '#fa5252' : preset.id === 'brick' ? '#f03e3e' : '#adb5bd',
      mass: stoneMass
    };

    stateRef.current.stones.push(newStone);
  }, [selectedPresetId, dropHeight]);

  // Handle manual surface clicking
  const handle2DClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvas2dRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Map screen click positions dynamically to internal GRID_SIZE
    const gx = (screenX / rect.width) * GRID_SIZE;
    const gy = (screenY / rect.height) * GRID_SIZE;

    if (gx > 1 && gx < GRID_SIZE - 2 && gy > 1 && gy < GRID_SIZE - 2) {
      if (simMode === 'throw') {
        triggerStoneSpawn(gx, gy);
      } else {
        // Direct surface ripple disturbance
        addDisturbance(stateRef.current.currentGrid, gx, gy, 2.5, 6 * tensionVal, GRID_SIZE);
      }
    }
  };

  // Drag on water surface logic
  const handleMouseDown = () => {
    stateRef.current.isDragging = true;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!stateRef.current.isDragging) return;
    const canvas = canvas2dRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const gx = (screenX / rect.width) * GRID_SIZE;
    const gy = (screenY / rect.height) * GRID_SIZE;

    if (gx > 1 && gx < GRID_SIZE - 2 && gy > 1 && gy < GRID_SIZE - 2) {
      // Create drag ripple disturbance
      addDisturbance(
        stateRef.current.currentGrid,
        gx,
        gy,
        2.0,
        1.5 * tensionVal,
        GRID_SIZE
      );
    }
  };

  const handleMouseUpOrLeave = () => {
    stateRef.current.isDragging = false;
  };

  // Reset/Clear Simulation Water
  const handleClearWater = () => {
    const size = GRID_SIZE;
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        stateRef.current.currentGrid[x][y] = 0;
        stateRef.current.previousGrid[x][y] = 0;
      }
    }
    stateRef.current.stones = [];
    stateRef.current.particles = [];
    stateRef.current.ticks = 0;
    
    // Clear metrics
    setMaxAmplitude(0);
    setLastImpactEnergy(0);
    setLastImpactVelocity(0);
  };

  // Main high-performance Animation Ref Loop
  useEffect(() => {
    let animId: number;

    const tick = () => {
      if (isPaused) {
        animId = requestAnimationFrame(tick);
        return;
      }

      stateRef.current.ticks += 1;
      const { currentGrid, previousGrid, stones, particles, ticks } = stateRef.current;
      const themeColors = activeTheme;

      // ---- 1. WAVE SOURCE / DRIP SIGNAL OSCILLATION GENERATION ----
      if (simMode === 'oscillator') {
        const sourceX = Math.floor(GRID_SIZE / 2);
        const sourceY = Math.floor(GRID_SIZE / 2);
        // Sinusoidal oscillating force
        currentGrid[sourceX][sourceY] = Math.sin(ticks * oscFrequency) * oscAmplitude;
        currentGrid[sourceX + 1][sourceY] = Math.sin(ticks * oscFrequency) * oscAmplitude;
        currentGrid[sourceX][sourceY + 1] = Math.sin(ticks * oscFrequency) * oscAmplitude;
      }

      // ---- 2. RANDOM GENTLE RAIN RAINDROPS ----
      if (simMode === 'rain' && Math.random() < rainIntensity) {
        const rx = 2 + Math.floor(Math.random() * (GRID_SIZE - 4));
        const ry = 2 + Math.floor(Math.random() * (GRID_SIZE - 4));
        const randomForce = 1.0 + Math.random() * 2.5;
        const randomRadius = 0.8 + Math.random() * 1.0;
        addDisturbance(currentGrid, rx, ry, randomRadius, randomForce * tensionVal, GRID_SIZE);
      }

      // ---- 3. SIMULATE FREE FALLING STONES ----
      for (let i = stones.length - 1; i >= 0; i--) {
        const stone = stones[i];
        // Stone free fall velocity
        stone.speed += 0.055; // simple gravitational acceleration mimicking 9.8m/s
        stone.currentZ -= stone.speed;

        if (stone.currentZ <= 0) {
          // --- STRIKE SHIELD / WATER SURFACE IMPACT REACHED ---
          const velocity = Math.sqrt(2 * 9.8 * stone.initialZ);
          const kineticEnergy = stone.mass * 9.8 * stone.initialZ;

          // Set user-facing statistics
          setLastImpactEnergy(kineticEnergy);
          setLastImpactVelocity(velocity);

          // Custom acoustic synthetic plop trigger
          if (soundEnabled) {
            playSplashSound(stone.mass, stone.initialZ);
          }

          // Induct physical kinetic disturbance to the wave heights grid
          const intensity = stone.mass * (1.2 + stone.initialZ * 0.15) * tensionVal;
          addDisturbance(
            currentGrid,
            stone.targetX,
            stone.targetY,
            stone.radius,
            intensity,
            GRID_SIZE
          );

          // Produce splash foam particles in 3D direction
          const particleCount = Math.floor(10 + stone.mass * 1.5 + stone.initialZ * 1.2);
          for (let p = 0; p < particleCount; p++) {
            const angle = Math.random() * Math.PI * 2;
            const spraySpeed = (0.4 + Math.random() * 1.4) * (1.0 + stone.initialZ * 0.05);
            const upwardVelocity = (0.5 + Math.random() * 1.5) * (1.0 + stone.initialZ * 0.1);

            particles.push({
              x: stone.targetX,
              y: stone.targetY,
              z: 0.1,
              vx: Math.cos(angle) * spraySpeed * 0.25,
              vy: Math.sin(angle) * spraySpeed * 0.25,
              vz: upwardVelocity * 0.25,
              size: 1.2 + Math.random() * 2.8,
              color: themeColors.foamColor,
              alpha: 0.8 + Math.random() * 0.2,
              decay: 0.015 + Math.random() * 0.015,
              gravity: 0.012,
            });
          }

          // Remove completed falling stone
          stones.splice(i, 1);
        }
      }

      // ---- 4. SPLASH PARTICLES EVOLUTION ----
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vz -= p.gravity; // applying gravity pull
        p.x += p.vx;
        p.y += p.vy;
        p.z += p.vz;
        p.alpha -= p.decay;

        if (p.z <= 0) {
          // Splashed particle hits the water back -> creates sub-ripple!
          if (p.alpha > 0.15) {
            addDisturbance(currentGrid, p.x, p.y, 0.6, 0.45 * tensionVal, GRID_SIZE);
          }
          particles.splice(i, 1);
          continue;
        }

        if (p.alpha <= 0) {
          particles.splice(i, 1);
        }
      }

      // ---- 5. PHYSICS FLUID PROPAGATION WAVE EQUATION ----
      // We repeat propagation based on wave speed multiplier
      for (let s = 0; s < wavesSpeed; s++) {
        const result = propagateWaves(
          stateRef.current.currentGrid,
          stateRef.current.previousGrid,
          GRID_SIZE,
          dampingVal
        );
        stateRef.current.currentGrid = result.current;
        stateRef.current.previousGrid = result.previous;
      }

      // Keep real-time metrics trackers
      let maxAmp = 0;
      for (let x = 0; x < GRID_SIZE; x++) {
        for (let y = 0; y < GRID_SIZE; y++) {
          const absAmp = Math.abs(stateRef.current.currentGrid[x][y]);
          if (absAmp > maxAmp) {
            maxAmp = absAmp;
          }
        }
      }
      setMaxAmplitude(maxAmp);
      setActiveStoneCount(stones.length);
      setActiveParticleCount(particles.length);

      // Record current max amplitude into oscilloscope queue
      stateRef.current.waveHistory.push(maxAmp);
      if (stateRef.current.waveHistory.length > 200) {
        stateRef.current.waveHistory.shift();
      }

      // ---- 6. ANIMATE RENDER STAGE (2D & 3D & Oscillo) ----
      renderVisualPools();

      animId = requestAnimationFrame(tick);
    };

    // Sub-render wrapper
    const renderVisualPools = () => {
      const grid = stateRef.current.currentGrid;
      const stones = stateRef.current.stones;
      const particles = stateRef.current.particles;
      const themeColors = activeTheme;

      // ----------------------------------------------------
      // A. RENDER 2D REFRACTIVE TOP-DOWN LIQUID VIEW
      // ----------------------------------------------------
      const canvas2d = canvas2dRef.current;
      const offscreen = offscreenCanvasRef.current;
      if (canvas2d && offscreen) {
        const ctxOff = offscreen.getContext('2d');
        const ctxOn = canvas2d.getContext('2d');
        
        if (ctxOff && ctxOn) {
          const imgData = ctxOff.createImageData(GRID_SIZE, GRID_SIZE);
          const data = imgData.data;

          const rgbWater = hexToRgb(themeColors.waterColor);
          const rgbRipple = hexToRgb(themeColors.rippleColor);
          const rgbHigh = hexToRgb(themeColors.highlightColor);

          // Pixel loop mapping height displacements to shadows & highlights
          for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
              // Discrete normal computation (Sobel-like gradient)
              const nextX = x === GRID_SIZE - 1 ? x : x + 1;
              const prevX = x === 0 ? x : x - 1;
              const nextY = y === GRID_SIZE - 1 ? y : y + 1;
              const prevY = y === 0 ? y : y - 1;

              const dx = grid[nextX][y] - grid[prevX][y];
              const dy = grid[x][nextY] - grid[x][prevY];
              const val = grid[x][y];

              // Light angle shader calculation
              const shading = (dx - dy) * 45; // light from top-left

              // Highlight curvature
              const laplacian = grid[nextX][y] + grid[prevX][y] + grid[x][nextY] + grid[x][prevY] - 4 * val;
              const peakHighlight = laplacian < -1.5 ? Math.abs(laplacian) * 12 : 0;

              let r = rgbWater.r + shading + peakHighlight;
              let g = rgbWater.g + shading + peakHighlight;
              let b = rgbWater.b + shading + peakHighlight;

              // Ripple blend interpolation
              if (val > 0.1) {
                const blend = Math.min(1.0, val * 0.12);
                r = r * (1 - blend) + rgbHigh.r * blend;
                g = g * (1 - blend) + rgbHigh.g * blend;
                b = b * (1 - blend) + rgbHigh.b * blend;
              } else if (val < -0.1) {
                const blend = Math.min(1.0, -val * 0.12);
                r = r * (1 - blend) + rgbRipple.r * blend;
                g = g * (1 - blend) + rgbRipple.g * blend;
                b = b * (1 - blend) + rgbRipple.b * blend;
              }

              const pixelIdx = (y * GRID_SIZE + x) * 4;
              data[pixelIdx]     = clamp(r, 0, 255);
              data[pixelIdx + 1] = clamp(g, 0, 255);
              data[pixelIdx + 2] = clamp(b, 0, 255);
              data[pixelIdx + 3] = 255;
            }
          }

          // Paint raw heightmap to size-scaled 64x64 offscreen
          ctxOff.putImageData(imgData, 0, 0);

          // Draw offscreen upscaled onto main viewport to get amazing smooth bilinear wave interpolation!
          ctxOn.imageSmoothingEnabled = true;
          ctxOn.drawImage(offscreen, 0, 0, canvas2d.width, canvas2d.height);

          // Overlay grid markers for experimental water design look
          ctxOn.strokeStyle = 'rgba(255, 255, 255, 0.035)';
          ctxOn.lineWidth = 0.5;
          const cellW = canvas2d.width / 8;
          for (let i = 1; i < 8; i++) {
            ctxOn.beginPath();
            ctxOn.moveTo(i * cellW, 0);
            ctxOn.lineTo(i * cellW, canvas2d.height);
            ctxOn.moveTo(0, i * cellW);
            ctxOn.lineTo(canvas2d.width, i * cellW);
            ctxOn.stroke();
          }

          // Render active falling stones
          stones.forEach(stone => {
            const scX = (stone.targetX / GRID_SIZE) * canvas2d.width;
            const scY = (stone.targetY / GRID_SIZE) * canvas2d.height;
            const radScale = (stone.radius / GRID_SIZE) * canvas2d.width * 2.2;

            // 1. Draw water projection shadow (fades in as stone falls)
            const shadowProgress = clamp(1 - (stone.currentZ / stone.initialZ), 0, 1);
            const shadowAlpha = 0.15 + shadowProgress * 0.45;
            
            ctxOn.beginPath();
            ctxOn.ellipse(scX, scY, radScale * 0.8, radScale * 0.4, 0, 0, Math.PI * 2);
            ctxOn.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
            ctxOn.fill();

            // 2. Draw actual stone with gravitational freefall height visual offset
            const stoneVisualY = scY - (stone.currentZ * 12.0); // 12px visual displacement per height meter
            
            // Stone gradient
            const stoneGrad = ctxOn.createRadialGradient(
              scX - radScale * 0.2,
              stoneVisualY - radScale * 0.2,
              2,
              scX,
              stoneVisualY,
              radScale
            );
            stoneGrad.addColorStop(0, '#e9ecef');
            stoneGrad.addColorStop(0.3, stone.color);
            stoneGrad.addColorStop(1, '#212529');

            ctxOn.beginPath();
            ctxOn.arc(scX, stoneVisualY, radScale, 0, Math.PI * 2);
            ctxOn.fillStyle = stoneGrad;
            ctxOn.shadowBlur = radScale * 0.4;
            ctxOn.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctxOn.fill();
            
            // Reset shadows
            ctxOn.shadowBlur = 0;

            // 3. Falling arrow trail indicator
            ctxOn.strokeStyle = 'rgba(255, 255, 255, 0.25)';
            ctxOn.lineWidth = 1.5;
            ctxOn.setLineDash([4, 4]);
            ctxOn.beginPath();
            ctxOn.moveTo(scX, stoneVisualY + radScale);
            ctxOn.lineTo(scX, scY);
            ctxOn.stroke();
            ctxOn.setLineDash([]);
          });

          // Render splash particles
          particles.forEach(p => {
            const scX = (p.x / GRID_SIZE) * canvas2d.width;
            const scY = (p.y / GRID_SIZE) * canvas2d.height;
            const size = (p.size / GRID_SIZE) * canvas2d.width;
            const visualY = scY - (p.z * 10); // height offset

            // Particle Drop shadow
            ctxOn.beginPath();
            ctxOn.ellipse(scX, scY, size * 0.8, size * 0.4, 0, 0, Math.PI * 2);
            ctxOn.fillStyle = `rgba(0, 0, 0, ${p.alpha * 0.35})`;
            ctxOn.fill();

            // Squirting Droplet
            ctxOn.beginPath();
            ctxOn.arc(scX, visualY, size, 0, Math.PI * 2);
            ctxOn.fillStyle = themeColors.highlightColor;
            ctxOn.globalAlpha = p.alpha;
            ctxOn.fill();
            ctxOn.globalAlpha = 1.0;
          });
        }
      }

      // ----------------------------------------------------
      // B. RENDER 3D ISOMETRIC/PERSPECTIVE SURFACE GRID WIREFRAME
      // ----------------------------------------------------
      const canvas3d = canvas3dRef.current;
      if (canvas3d) {
        const ctxOn = canvas3d.getContext('2d');
        if (ctxOn) {
          ctxOn.clearRect(0, 0, canvas3d.width, canvas3d.height);

          // Nice dark grid analyzer backdrop
          ctxOn.fillStyle = '#060a12';
          ctxOn.fillRect(0, 0, canvas3d.width, canvas3d.height);

          // Hologram lines
          ctxOn.strokeStyle = 'rgba(255, 255, 255, 0.05)';
          ctxOn.lineWidth = 1;
          for (let l = 0; l < canvas3d.height; l += 25) {
            ctxOn.beginPath();
            ctxOn.moveTo(0, l);
            ctxOn.lineTo(canvas3d.width, l);
            ctxOn.stroke();
          }

          // Precompute mapped projection 3D coordinates for the grid points
          // To make wireframe look clean, we draw lines. Grid is 64x64.
          // Drawing every 2nd cell (32x32) creates spectacular high-density and keeps it perfect.
          const stepSize = 2;
          const pGrid: { x: number; y: number; h: number }[][] = [];

          const rgbHigh = hexToRgb(themeColors.highlightColor);
          const rgbWater = hexToRgb(themeColors.waterColor);

          // Project grid matrix
          for (let y = 0; y < GRID_SIZE; y += stepSize) {
            const row: { x: number; y: number; h: number }[] = [];
            for (let x = 0; x < GRID_SIZE; x += stepSize) {
              const hVal = grid[x][y];
              
              // Map x, y indices to [-0.5, 0.5] world positions
              const worldX = (x / (GRID_SIZE - 1)) - 0.5;
              const worldZ = (y / (GRID_SIZE - 1)) - 0.5;
              // Amplify height: base displacement scaled
              const worldY = hVal * 0.12; 

              const proj = project3D(worldX, worldY, worldZ, yaw, pitch, canvas3d.width, canvas3d.height, zoom);
              row.push({ x: proj.x, y: proj.y, h: hVal });
            }
            pGrid.push(row);
          }

          // Draw glass container boundary walls in 3D perspective to look like an actual water tank!
          const corner00 = project3D(-0.5, -0.15, -0.5, yaw, pitch, canvas3d.width, canvas3d.height, zoom);
          const corner01 = project3D(-0.5, -0.15, 0.5, yaw, pitch, canvas3d.width, canvas3d.height, zoom);
          const corner10 = project3D(0.5, -0.15, -0.5, yaw, pitch, canvas3d.width, canvas3d.height, zoom);
          const corner11 = project3D(0.5, -0.15, 0.5, yaw, pitch, canvas3d.width, canvas3d.height, zoom);

          const corner00Top = project3D(-0.5, 0, -0.5, yaw, pitch, canvas3d.width, canvas3d.height, zoom);
          const corner01Top = project3D(-0.5, 0, 0.5, yaw, pitch, canvas3d.width, canvas3d.height, zoom);
          const corner10Top = project3D(0.5, 0, -0.5, yaw, pitch, canvas3d.width, canvas3d.height, zoom);
          const corner11Top = project3D(0.5, 0, 0.5, yaw, pitch, canvas3d.width, canvas3d.height, zoom);

          // Draw the bottom plate
          ctxOn.strokeStyle = 'rgba(255, 255, 255, 0.08)';
          ctxOn.fillStyle = 'rgba(10, 30, 60, 0.15)';
          ctxOn.beginPath();
          ctxOn.moveTo(corner00.x, corner00.y);
          ctxOn.lineTo(corner01.x, corner01.y);
          ctxOn.lineTo(corner11.x, corner11.y);
          ctxOn.lineTo(corner10.x, corner10.y);
          ctxOn.closePath();
          ctxOn.fill();
          ctxOn.stroke();

          // Draw pool corner columns
          ctxOn.strokeStyle = 'rgba(255, 255, 255, 0.12)';
          ctxOn.lineWidth = 1.5;
          const drawCol = (b: typeof corner00, t: typeof corner00) => {
            ctxOn.beginPath();
            ctxOn.moveTo(b.x, b.y);
            ctxOn.lineTo(t.x, t.y);
            ctxOn.stroke();
          };
          drawCol(corner00, corner00Top);
          drawCol(corner01, corner01Top);
          drawCol(corner10, corner10Top);
          drawCol(corner11, corner11Top);

          // Draw the mesh lines
          const rLines = pGrid.length;
          const cLines = pGrid[0].length;

          ctxOn.lineWidth = 1.2;

          for (let r = 0; r < rLines; r++) {
            for (let c = 0; c < cLines; c++) {
              const currentP = pGrid[r][c];

              // Color dynamically based on wave displacement (High crests glow cyan, troughs glow purple-deep)
              const offsetVal = currentP.h; // wave amplitude
              
              let rCol = rgbWater.r;
              let gCol = rgbWater.g;
              let bCol = rgbWater.b;

              if (offsetVal > 0.05) {
                const ratio = Math.min(1.0, offsetVal * 0.15);
                rCol = rgbWater.r + (rgbHigh.r - rgbWater.r) * ratio;
                gCol = rgbWater.g + (rgbHigh.g - rgbWater.g) * ratio;
                bCol = rgbWater.b + (rgbHigh.b - rgbWater.b) * ratio;
              } else if (offsetVal < -0.05) {
                const ratio = Math.min(1.0, -offsetVal * 0.15);
                rCol = rgbWater.r * (1 - ratio);
                gCol = rgbWater.g * (1 - ratio);
                bCol = rgbWater.b * (1 - ratio);
              }

              ctxOn.strokeStyle = `rgb(${Math.floor(rCol)}, ${Math.floor(gCol)}, ${Math.floor(bCol)})`;

              // Line to column neighbor
              if (c < cLines - 1) {
                const neighborC = pGrid[r][c + 1];
                ctxOn.beginPath();
                ctxOn.moveTo(currentP.x, currentP.y);
                ctxOn.lineTo(neighborC.x, neighborC.y);
                ctxOn.stroke();
              }

              // Line to row neighbor
              if (r < rLines - 1) {
                const neighborR = pGrid[r + 1][c];
                ctxOn.beginPath();
                ctxOn.moveTo(currentP.x, currentP.y);
                ctxOn.lineTo(neighborR.x, neighborR.y);
                ctxOn.stroke();
              }
            }
          }

          // Center coordinate visual axis label
          ctxOn.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctxOn.font = '10px Courier New';
          ctxOn.fillText('Z⁺', corner01Top.x - 12, corner01Top.y + 12);
          ctxOn.fillText('X⁺', corner11Top.x + 8, corner11Top.y + 4);
          ctxOn.fillText('Y (높이)', corner00Top.x - 28, corner00Top.y - 12);
        }
      }

      // ----------------------------------------------------
      // C. RENDER REAL-TIME WAVE WAVEFORM ANALYZER / OSCILLOSCOPE
      // ----------------------------------------------------
      const canvasOsc = osciRef.current;
      if (canvasOsc) {
        const ctxOn = canvasOsc.getContext('2d');
        if (ctxOn) {
          ctxOn.clearRect(0, 0, canvasOsc.width, canvasOsc.height);
          
          // Technical osci grid lines
          ctxOn.fillStyle = '#0f172a';
          ctxOn.fillRect(0, 0, canvasOsc.width, canvasOsc.height);

          ctxOn.strokeStyle = 'rgba(255, 255, 255, 0.05)';
          ctxOn.lineWidth = 0.5;
          // horizontal divisions
          for (let y = 0; y < canvasOsc.height; y += 15) {
            ctxOn.beginPath();
            ctxOn.moveTo(0, y);
            ctxOn.lineTo(canvasOsc.width, y);
            ctxOn.stroke();
          }
          // vertical divisions
          for (let x = 0; x < canvasOsc.width; x += 30) {
            ctxOn.beginPath();
            ctxOn.moveTo(x, 0);
            ctxOn.lineTo(x, canvasOsc.height);
            ctxOn.stroke();
          }

          const history = stateRef.current.waveHistory;
          if (history.length > 2) {
            ctxOn.beginPath();
            ctxOn.strokeStyle = themeColors.highlightColor;
            ctxOn.shadowColor = themeColors.highlightColor;
            ctxOn.shadowBlur = 6;
            ctxOn.lineWidth = 2.0;

            const dx = canvasOsc.width / 200;
            const midY = canvasOsc.height - 10; // floor center

            for (let i = 0; i < history.length; i++) {
              // Convert absolute wave energy to scale visual height
              const h = Math.min(canvasOsc.height - 15, history[i] * 3.5);
              const xCoord = i * dx;
              const yCoord = midY - h;

              if (i === 0) {
                ctxOn.moveTo(xCoord, yCoord);
              } else {
                ctxOn.lineTo(xCoord, yCoord);
              }
            }
            ctxOn.stroke();
            ctxOn.shadowBlur = 0; // reset glow
          }

          // Oscilloscope reference border banner
          ctxOn.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctxOn.font = '9px monospace';
          ctxOn.fillText('LIVE WAVE AMPLITUDE (진폭 변위)', 8, 12);
        }
      }
    };

    animId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [selectedPresetId, dropHeight, activeThemeId, simMode, dampingVal, wavesSpeed, tensionVal, rainIntensity, oscFrequency, oscAmplitude, soundEnabled, yaw, pitch, zoom, isPaused]);

  // Handle preset settings click
  const configurePhysicsValues = (damping: number, speed: number, tension: number) => {
    setDampingVal(damping);
    setWavesSpeed(speed);
    setTensionVal(tension);
  };

  return (
    <div className="min-h-screen bg-[#020C12] text-slate-100 flex flex-col font-sans relative overflow-x-hidden antialiased select-none">
      
      {/* Immersive Cybernetic Background Layer */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,_#0A2A3D_0%,_#020C12_85%)] pointer-events-none z-0" />
      <div className="absolute inset-0 opacity-15 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] pointer-events-none z-0" />

      {/* --- EXQUISITE HIGH-END HEADER BAR --- */}
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-xl sticky top-0 z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-emerald-500 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.4)] animate-pulse">
              <Waves className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-wider text-white uppercase flex items-center gap-2">
                AQUA<span className="text-cyan-400">SIM</span>
                <span className="text-[9px] tracking-widest bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 font-mono px-2 py-0.5 rounded-full">v2.0 PRO</span>
              </h1>
              <p className="text-[10px] text-slate-400 font-mono tracking-widest uppercase">Hydrodynamic Ripple Engine</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap justify-center font-mono">
            {/* Simulation Status Controls */}
            <button
              onClick={() => setIsPaused(!isPaused)}
              className={`px-4 py-2 rounded-lg border transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer ${
                isPaused 
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20 shadow-[0_0_10px_rgba(245,158,11,0.15)]' 
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
              title={isPaused ? "시뮬레이션 재개" : "시뮬레이션 일시 정지"}
              id="pause_btn"
            >
              {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              {isPaused ? "START" : "STOP"}
            </button>

            {/* Clear Button */}
            <button
              onClick={handleClearWater}
              className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 hover:border-red-500/30 transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
              title="수면 평탄화 초기화"
              id="clear_btn"
            >
              <Trash2 className="h-3.5 w-3.5" />
              CLEAR
            </button>

            {/* Sound Toggle */}
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg border transition-all flex items-center justify-center cursor-pointer ${
                soundEnabled 
                  ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.15)]' 
                  : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
              }`}
              title={soundEnabled ? "물 음향 활성화됨" : "음향 무음"}
              id="sound_btn"
            >
              {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>

            {/* Toggle explanation accordion */}
            <button
              onClick={() => setShowExplanation(!showExplanation)}
              className={`px-3 py-2 rounded-lg border transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer ${
                showExplanation 
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.15)]' 
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
              id="info_btn"
            >
              <Info className="h-3.5 w-3.5" />
              INFO ({showExplanation ? "CLOSE" : "OPEN"})
            </button>
          </div>
        </div>
      </header>

      {/* --- LIVE STATS TELEMETRY BAR --- */}
      <div className="bg-black/20 border-b border-white/5 px-6 py-3 sticky top-[73px] z-40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-4 text-center font-mono relative z-10">
          <div className="bg-black/30 p-2 rounded-xl border border-white/5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
            <span className="block text-[9px] text-slate-400 uppercase tracking-widest font-bold">Max Amplitude (실시간 파고)</span>
            <span className="text-sm font-bold text-cyan-400 tracking-wider">{(maxAmplitude * 1.5).toFixed(2)} cm</span>
          </div>
          <div className="bg-black/30 p-2 rounded-xl border border-white/5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
            <span className="block text-[9px] text-slate-400 uppercase tracking-widest font-bold">Fall Velocity (낙하 속도)</span>
            <span className="text-sm font-bold text-indigo-300 tracking-wider">
              {lastImpactVelocity > 0 ? `${lastImpactVelocity.toFixed(1)} m/s` : '0.0 m/s'}
            </span>
          </div>
          <div className="bg-black/30 p-2 rounded-xl border border-white/5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
            <span className="block text-[9px] text-slate-400 uppercase tracking-widest font-bold">Impact Energy (충격 에너지)</span>
            <span className="text-sm font-bold text-amber-300 tracking-wider">
              {lastImpactEnergy > 0 ? `${lastImpactEnergy.toFixed(1)} J` : '0.0 J'}
            </span>
          </div>
          <div className="bg-black/30 p-2 rounded-xl border border-white/5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
            <span className="block text-[9px] text-slate-400 uppercase tracking-widest font-bold">Debris count (물보라 입자)</span>
            <span className="text-sm font-bold text-emerald-400 tracking-wider">
              {activeParticleCount} <span className="text-[10px] text-slate-500">units</span>
            </span>
          </div>
        </div>
      </div>

      {/* --- EXPLANATION & PHYSICS CONCEPTS PANEL --- */}
      <AnimatePresence>
        {showExplanation && (
          <motion.section
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-black/40 border-b border-white/5 overflow-hidden backdrop-blur-md relative z-10"
          >
            <div className="max-w-7xl mx-auto p-5 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-slate-300">
              <div className="bg-black/30 p-4 rounded-xl border border-white/5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
                <h3 className="text-white font-medium mb-2 flex items-center gap-1.5 text-cyan-400">
                  <Waves className="h-4 w-4" />
                  파동의 전파와 점성 (Viscosity)
                </h3>
                <p className="text-xs leading-relaxed text-slate-400 font-sans">
                  수면에 전달된 에너지는 사방의 물벼락(동심원)으로 교란되어 외곽으로 전달됩니다. 
                  <strong> 매개 점성(물 속성)</strong>이 작을수록 파동 감쇠가 적어 아주 멀리 오랫동안 파동이 나아가며, 
                  점성이 높으면(기름 등) 충격파가 빠르게 흡수되어 사라집니다.
                </p>
              </div>
              <div className="bg-black/30 p-4 rounded-xl border border-white/5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
                <h3 className="text-white font-medium mb-2 flex items-center gap-1.5 text-indigo-400">
                  <ArrowDown className="h-4 w-4" />
                  위치에너지와 자유낙하 (Ep)
                </h3>
                <p className="text-xs leading-relaxed text-slate-400 font-sans">
                  높이가 증가할수록 중력이 가속되어 수면에 도달할 때의 수직속도 v와 
                  운동 에너지(E = m * g * h)가 격상됩니다. 이에 따라 수면에 닿았을 때의 최초 파고가 크게 용솟음 치며, 
                  하늘 높이 날아오르는 고압의 물방울 파편(Particles) 개수가 증강됩니다.
                </p>
              </div>
              <div className="bg-black/30 p-4 rounded-xl border border-white/5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
                <h3 className="text-white font-medium mb-2 flex items-center gap-1.5 text-emerald-400">
                  <Sparkles className="h-4 w-4" />
                  중첩과 매질 분석 (Superposition)
                </h3>
                <p className="text-xs leading-relaxed text-slate-400 font-sans">
                  연속된 빗방울이나 다중 돌 투하 시 각 파동들은 서로를 왜곡시키거나 통과하면서 간섭합니다. 
                  3D 와이어프레임 렌더링을 통과하며 융기된 <strong>보강 간섭(마루-마루)</strong>과 평탄히 깎이는 <strong>상쇄 간섭(마루-골)</strong>의 기하학적 전경을 실시간으로 연구할 수 있습니다.
                </p>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* --- MAIN WORKSPACE INTERACTIVE HUB --- */}
      <main className="flex-1 p-4 lg:p-6 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-start relative z-10">
        
        {/* ==================================================== */}
        {/* LEFT COLUMN: SIMULATION PHYSICS SETTINGS CONTROL ROOM (4/12) */}
        {/* ==================================================== */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          {/* Preset Rock Types selection */}
          <div className="bg-black/30 border border-white/5 p-5 rounded-2xl flex flex-col gap-4 shadow-[0_4px_30px_rgba(0,0,0,0.4)] backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase font-mono">STEP 1. 돌맹이 질량 / 크기</span>
              <span className="text-xs text-cyan-400 font-mono font-bold bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-800/30">
                질량: {selectedPreset.mass.toFixed(1)}kg
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              {STONE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPresetId(p.id)}
                  className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer group ${
                    selectedPresetId === p.id
                      ? `bg-cyan-500/10 border-cyan-400 shadow-md shadow-cyan-400/5`
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                  id={`preset_${p.id}`}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <span className="text-xl">{p.icon}</span>
                    <span className="text-[10px] font-mono text-slate-400">{p.sizeDesc}</span>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white group-hover:text-cyan-300 transition-colors">{p.label}</h4>
                  </div>
                </button>
              ))}
            </div>
            
            <p className="text-xs text-slate-400 leading-relaxed bg-black/40 p-3 rounded-lg border border-white/5">
              {selectedPreset.description}
            </p>
          </div>

          {/* Fall Height Slider controls */}
          <div className="bg-black/30 border border-white/5 p-5 rounded-2xl flex flex-col gap-4 shadow-[0_4px_30px_rgba(0,0,0,0.4)] backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase font-mono">STEP 2. 투하 고도</span>
              <span className="text-xs text-indigo-400 font-mono font-bold bg-indigo-950/40 px-1.5 py-0.5 rounded border border-indigo-850/30">
                Height: {dropHeight.toFixed(1)}m
              </span>
            </div>

            {/* Slider track design */}
            <div className="space-y-3">
              <input
                type="range"
                min="0.5"
                max="10.0"
                step="0.5"
                value={dropHeight}
                onChange={(e) => setDropHeight(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-500 focus:outline-none"
                id="height_slider"
              />
              <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                <span>살짝 던지기 (0.5m)</span>
                <span>서서 던지기 (5m)</span>
                <span>고공 절벽 (10m)</span>
              </div>
            </div>

            {/* Physics evaluation values readout */}
            <div className="bg-black/50 p-3 rounded-lg border border-white/5 grid grid-cols-2 gap-2 text-xs">
              <div className="space-y-1">
                <span className="text-slate-400 text-[10px]">입수 시간 (예상)</span>
                <span className="block font-mono text-white font-semibold text-xs">
                  {Math.sqrt((2 * dropHeight) / 9.8).toFixed(2)} 초
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-slate-400 text-[10px]">도달 정단 속도</span>
                <span className="block font-mono text-white font-semibold text-xs">
                  {Math.sqrt(2 * 9.8 * dropHeight).toFixed(1)} m/s
                </span>
              </div>
            </div>
          </div>

          {/* Interactive Modes controls */}
          <div className="bg-black/30 border border-white/5 p-5 rounded-2xl flex flex-col gap-4 shadow-[0_4px_30px_rgba(0,0,0,0.4)] backdrop-blur-xl">
            <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase font-mono">STEP 3. 입수 제어 방식</span>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setSimMode('throw')}
                className={`py-2 px-1 rounded-lg text-xs font-medium text-center transition-all cursor-pointer flex flex-col items-center gap-1.5 border ${
                  simMode === 'throw'
                    ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 ring-1 ring-cyan-500/20'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
                }`}
                id="mode_throw"
              >
                <div className="h-5 w-5 rounded-full bg-white/5 flex items-center justify-center">
                  <ArrowDown className="h-3 w-3" />
                </div>
                <span>돌 던지기</span>
              </button>
              <button
                onClick={() => setSimMode('rain')}
                className={`py-2 px-1 rounded-lg text-xs font-medium text-center transition-all cursor-pointer flex flex-col items-center gap-1.5 border ${
                  simMode === 'rain'
                    ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 ring-1 ring-cyan-500/20'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
                }`}
                id="mode_rain"
              >
                <div className="h-5 w-5 rounded-full bg-white/5 flex items-center justify-center">
                  <CloudRain className="h-3 w-3" />
                </div>
                <span>빗방울 효과</span>
              </button>
              <button
                onClick={() => setSimMode('oscillator')}
                className={`py-2 px-1 rounded-lg text-xs font-medium text-center transition-all cursor-pointer flex flex-col items-center gap-1.5 border ${
                  simMode === 'oscillator'
                    ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 ring-1 ring-cyan-500/20'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
                }`}
                id="mode_osc"
              >
                <div className="h-5 w-5 rounded-full bg-white/5 flex items-center justify-center">
                  <Activity className="h-3 w-3" />
                </div>
                <span>주파진 발생기</span>
              </button>
            </div>

            {/* Mode Specific parameters options controls */}
            <AnimatePresence mode="wait font-mono">
              {simMode === 'rain' && (
                <motion.div
                  key="rain-settings"
                  initial={{ opacity: 0, scaleY: 0.9 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  exit={{ opacity: 0, scaleY: 0.9 }}
                  className="bg-black/50 p-3 rounded-xl border border-white/5 space-y-2.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-sans">빗줄기 강도 (Rain Intensity)</span>
                    <span className="font-mono text-cyan-400">{(rainIntensity * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="0.45"
                    step="0.02"
                    value={rainIntensity}
                    onChange={(e) => setRainIntensity(parseFloat(e.target.value))}
                    className="w-full h-1 bg-white/15 rounded appearance-none cursor-pointer accent-cyan-400"
                    id="rain_slider"
                  />
                </motion.div>
              )}

              {simMode === 'oscillator' && (
                <motion.div
                  key="osc-settings"
                  initial={{ opacity: 0, scaleY: 0.9 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  exit={{ opacity: 0, scaleY: 0.9 }}
                  className="bg-black/50 p-3 rounded-xl border border-white/5 space-y-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-sans">주기 주파수 (Frequency)</span>
                      <span className="font-mono text-cyan-400">{(oscFrequency * 10).toFixed(1)} Hz</span>
                    </div>
                    <input
                      type="range"
                      min="0.05"
                      max="0.30"
                      step="0.01"
                      value={oscFrequency}
                      onChange={(e) => setOscFrequency(parseFloat(e.target.value))}
                      className="w-full h-1 bg-white/15 rounded appearance-none cursor-pointer accent-cyan-400"
                      id="osc_freq_slider"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-sans">발생 진폭 (Amplitude)</span>
                      <span className="font-mono text-indigo-400">{oscAmplitude.toFixed(1)} N</span>
                    </div>
                    <input
                      type="range"
                      min="2.0"
                      max="15.0"
                      step="0.5"
                      value={oscAmplitude}
                      onChange={(e) => setOscAmplitude(parseFloat(e.target.value))}
                      className="w-full h-1 bg-white/15 rounded appearance-none cursor-pointer accent-indigo-400"
                      id="osc_amp_slider"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Water Physics Custom Properties Sliders */}
          <div className="bg-black/30 border border-white/5 p-5 rounded-2xl flex flex-col gap-4 shadow-[0_4px_30px_rgba(0,0,0,0.4)] backdrop-blur-xl">
            <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase font-mono flex items-center gap-1.5">
              <Sliders className="h-3.5 w-3.5 text-slate-400" />
              수면 물리 속성 (Advanced)
            </span>

            <div className="space-y-4">
              {/* Damping viscosity */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-400 font-sans">액체 감쇠율-점성 (Damping / Viscosity)</span>
                  <span className="text-slate-300">{(1 - dampingVal).toFixed(3)}</span>
                </div>
                <input
                  type="range"
                  min="0.940"
                  max="0.996"
                  step="0.002"
                  value={dampingVal}
                  onChange={(e) => setDampingVal(parseFloat(e.target.value))}
                  className="w-full h-1 bg-white/10 rounded appearance-none cursor-pointer accent-cyan-500"
                  id="damping_slider"
                />
                <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                  <span>알코올 (물결 장시간)</span>
                  <span>글리세린 (점성 흡수)</span>
                </div>
              </div>

              {/* Wave propagation velocity */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-400 font-sans">파동 전파 연산 속도 (Substeps)</span>
                  <span className="text-slate-300">{wavesSpeed}x</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="4"
                  step="1"
                  value={wavesSpeed}
                  onChange={(e) => setWavesSpeed(parseInt(e.target.value, 10))}
                  className="w-full h-1 bg-white/10 rounded appearance-none cursor-pointer accent-indigo-500"
                  id="speed_slider"
                />
              </div>

              {/* Restoring tension scaler */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-400 font-sans">물 표면 탄성/장력 계수 (Tension Scale)</span>
                  <span className="text-slate-300">{tensionVal.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={tensionVal}
                  onChange={(e) => setTensionVal(parseFloat(e.target.value))}
                  className="w-full h-1 bg-white/10 rounded appearance-none cursor-pointer accent-teal-500"
                  id="tension_slider"
                />
              </div>

              {/* Presets macro definitions */}
              <div className="pt-2 grid grid-cols-2 gap-2 font-mono">
                <button
                  onClick={() => configurePhysicsValues(0.990, 1, 0.8)}
                  className="py-1.5 px-2 bg-white/5 border border-white/5 text-[10px] text-slate-400 rounded-lg hover:bg-white/10 hover:text-white transition-all cursor-pointer"
                  id="preset_heavy_water"
                >
                  기본 맑은 물물성
                </button>
                <button
                  onClick={() => configurePhysicsValues(0.950, 1, 1.4)}
                  className="py-1.5 px-2 bg-white/5 border border-white/5 text-[10px] text-slate-400 rounded-lg hover:bg-white/10 hover:text-white transition-all cursor-pointer"
                  id="preset_honey_liquid"
                >
                  끈적이는 고점성
                </button>
              </div>
            </div>
          </div>

          {/* Visual Theme templates */}
          <div className="bg-black/30 border border-white/5 p-5 rounded-2xl flex flex-col gap-4 shadow-[0_4px_30px_rgba(0,0,0,0.4)] backdrop-blur-xl">
            <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase font-mono">수면 수중 비주얼 테마</span>
            <div className="grid grid-cols-2 gap-2">
              {WATER_THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveThemeId(t.id)}
                  className={`p-2 rounded-lg text-xs font-medium text-left transition-all border flex items-center gap-2 cursor-pointer ${
                    activeThemeId === t.id
                      ? 'bg-white/15 border-white/20 text-white font-semibold shadow-[0_0_15px_rgba(255,255,255,0.05)]'
                      : 'bg-white/5 border-white/5 text-slate-400 hover:text-slate-300'
                  }`}
                  id={`theme_${t.id}`}
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: t.highlightColor }}
                  />
                  <span className="truncate">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* ==================================================== */}
        {/* RIGHT COLUMN: SIMULATION DISPLAY & GRAPHS PORTAL (8/12) */}
        {/* ==================================================== */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          
          {/* Main Canvases panel */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* 2D View Top-down interactive pool */}
            <div className="bg-black/30 border border-white/5 p-5 rounded-2xl flex flex-col gap-3.5 shadow-[0_4px_30px_rgba(0,0,0,0.4)] backdrop-blur-xl hover:border-white/10 transition-all duration-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 tracking-wider uppercase font-mono">
                  <Droplet className="h-4 w-4 text-cyan-400" />
                  2D 정면 감지 수면 (Top-Down Pool)
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  {simMode === 'throw' ? '수면 클릭시 돌 낙하' : '수면 드래그하여 흔들기'}
                </div>
              </div>

              {/* The Interactive canvas stage */}
              <div 
                className="relative aspect-square w-full rounded-xl bg-black overflow-hidden cursor-crosshair border border-white/5"
                style={{ contentVisibility: 'auto' }}
              >
                <canvas
                  ref={canvas2dRef}
                  width={512}
                  height={512}
                  onMouseDown={(e) => {
                    handleMouseDown();
                    handle2DClick(e);
                  }}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUpOrLeave}
                  onMouseLeave={handleMouseUpOrLeave}
                  className="w-full h-full block"
                  id="canvas_2d"
                />
                
                {/* Visual tutorial indicator */}
                <div className="absolute bottom-3 left-3 bg-black/80 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-white/5 text-[10px] text-slate-400 font-mono flex items-center gap-1.5 shadow-md">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                  64x64 Hydrodynamic Grid
                </div>
              </div>
            </div>

            {/* 3D Wave Wireframe mesh view */}
            <div className="bg-black/30 border border-white/5 p-5 rounded-2xl flex flex-col gap-3.5 shadow-[0_4px_30px_rgba(0,0,0,0.4)] backdrop-blur-xl hover:border-white/10 transition-all duration-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 tracking-wider uppercase font-mono">
                  <Rotate3D className="h-4 w-4 text-indigo-400" />
                  3D 고저도 레이더 (Wireframe Model)
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  우측 아래 슬라이더로 시선 회전 가능
                </div>
              </div>

              {/* Solid Grid 3D viewer canvas */}
              <div className="relative aspect-square w-full rounded-xl bg-black overflow-hidden border border-white/5">
                <canvas
                  ref={canvas3dRef}
                  width={512}
                  height={512}
                  className="w-full h-full block"
                  id="canvas_3d"
                />

                {/* 3D control rotations pad overlay */}
                <div className="absolute right-3.5 bottom-3 px-3.5 py-2.5 bg-black/85 backdrop-blur-md border border-white/10 rounded-xl max-w-[175px] space-y-2.5 self-end shadow-lg">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[8px] font-mono text-slate-400 uppercase tracking-wider">
                      <span>가로 회전 Yaw</span>
                      <span>{(yaw * (180/Math.PI)).toFixed(0)}°</span>
                    </div>
                    <input
                      type="range"
                      min={-Math.PI / 2}
                      max={Math.PI / 2}
                      step={0.05}
                      value={yaw}
                      onChange={(e) => setYaw(parseFloat(e.target.value))}
                      className="w-full h-1 appearance-none bg-white/15 cursor-pointer accent-cyan-400"
                      id="yaw_slider"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[8px] font-mono text-slate-400 uppercase tracking-wider">
                      <span>세로 눕기 Pitch</span>
                      <span>{(pitch * (180/Math.PI)).toFixed(0)}°</span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={Math.PI / 2.1}
                      step={0.05}
                      value={pitch}
                      onChange={(e) => setPitch(parseFloat(e.target.value))}
                      className="w-full h-1 appearance-none bg-white/15 cursor-pointer accent-indigo-400"
                      id="pitch_slider"
                    />
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Oscilloscope Real-time Wave Analyzer bottom block */}
          <div className="bg-black/30 border border-white/5 p-5 rounded-2xl flex flex-col gap-4 shadow-[0_4px_30px_rgba(0,0,0,0.4)] backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase font-mono flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-emerald-400 animate-pulse" />
                정사각 교란 파형 오실로스코프 (Wave Oscilloscope)
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] bg-white/5 border border-white/5 px-2 py-0.5 rounded font-mono text-slate-400">FPS: 60Hz Locked</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
              {/* The Oscilloscope mini canvas */}
              <div className="md:col-span-8 h-24 rounded-xl overflow-hidden border border-white/5 bg-black relative">
                <canvas
                  ref={osciRef}
                  width={460}
                  height={96}
                  className="w-full h-full block"
                  id="canvas_oscilloscope"
                />
              </div>

              {/* Data readouts panel */}
              <div className="md:col-span-4 bg-black/50 p-3 rounded-xl border border-white/5 h-24 flex flex-col justify-between text-xs font-mono">
                <div className="space-y-1">
                  <span className="text-slate-500 text-[10px] font-sans">수면 안정 등급 (Stability)</span>
                  <span className={`block font-bold tracking-wide ${
                    maxAmplitude < 0.2 ? 'text-emerald-400' : maxAmplitude < 1.5 ? 'text-cyan-400' : 'text-rose-500 animate-pulse font-extrabold'
                  }`}>
                    {maxAmplitude < 0.2 ? '● 극히 고요함 (Flat)' : maxAmplitude < 1.5 ? '● 물결 요동 (Active)' : '● 거대 파형 충격 (Extreme)'}
                  </span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-slate-500 text-[10px] font-sans">파동 추정 전파 진동수</span>
                  <div className="text-xs font-bold text-white flex items-center justify-between">
                    <span>Freq Factor:</span>
                    <span>{(oscFrequency * 10).toFixed(2)} rad/s</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick learning prompt tips */}
          <div className="bg-cyan-500/5 border border-cyan-500/10 p-4.5 rounded-xl flex items-start gap-3.5 text-xs text-slate-300 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
            <HelpCircle className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h5 className="font-semibold text-white">💡 시뮬레이터 이용 가이드</h5>
              <p className="text-slate-400 leading-relaxed font-normal">
                1단계에서 **거대 바위**를 선택하고, 고도를 **10m**로 올린 후, 2D Top-Down 수면의 임의의 위치를 클릭해 보세요. 
                커다란 충격 파폭과 함께 하늘 위로 분출된 수많은 물방울이 수면으로 재낙하하여 일으키는 **조화로운 중첩 잔물결**을 3D 와이어프레이름 분석 레이더를 통해 입체적으로 분석할 수 있습니다.
              </p>
            </div>
          </div>

        </div>

      </main>

      {/* --- FOOLPROOF BOTTOM FOOTER BANNER --- */}
      <footer className="border-t border-white/5 mt-auto py-5 text-center text-[10px] text-slate-500 tracking-wider font-mono bg-black/60 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <span>© 14-May-2026 Fluid Surface Finite Difference Wave Simulator</span>
          <span>Designed with HTML5 Canvas & Web Audio API (Strictly Client-side Offline)</span>
        </div>
      </footer>

    </div>
  );
}

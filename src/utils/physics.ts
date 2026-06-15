/**
 * Web Audio API Sound Synthesizer for physical water splash.
 * Synthesizes a bubble 'plop' sound and a turbulent water white-noise splash.
 */
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function playSplashSound(mass: number, height: number) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  
  // Volume based on height and mass
  const volume = Math.min(1.0, (0.2 + (mass * 0.15)) * (0.4 + (height * 0.15)));
  if (volume <= 0.05) return;

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0, now);
  masterGain.gain.linearRampToValueAtTime(volume, now + 0.01);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5 + mass * 0.1);
  masterGain.connect(ctx.destination);

  // 1. Synthesize the "Plop" (The air cavity / bubble sound)
  // Recreates the bubble sound: oscillator sweeps UPWARDS rapidly.
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  
  // Larger elements have lower frequency plops
  const startFreq = Math.max(80, 240 - mass * 15);
  const endFreq = Math.max(300, 650 - mass * 30);
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startFreq, now);
  // Frequency sweeps upwards - this represents the classic water plop bubble effect
  osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.08 + (mass * 0.01));

  oscGain.gain.setValueAtTime(volume * 0.8, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15 + (mass * 0.02));

  osc.connect(oscGain);
  oscGain.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.35);

  // 2. Synthesize the "Splash Noise" (The water turbulence)
  // Uses simulated noise filtered dynamically
  const bufferSize = ctx.sampleRate * 0.4; // 0.4 seconds of splash noise
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  
  // Generate white noise with random samples
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }

  const noiseNode = ctx.createBufferSource();
  noiseNode.buffer = noiseBuffer;

  // Filter white noise to model splash frequencies
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  
  // Larger objects create lower-pitched splashes, higher height creates sharper impacts
  const splashStartFilter = Math.max(500, 4000 - mass * 200 + height * 100);
  const splashEndFilter = Math.max(200, 1200 - mass * 100);
  
  bandpass.frequency.setValueAtTime(splashStartFilter, now);
  bandpass.frequency.exponentialRampToValueAtTime(splashEndFilter, now + 0.15);
  bandpass.Q.setValueAtTime(8, now); // high resonance for "splashiness"

  const noiseGain = ctx.createGain();
  // Noise volume decays very rapidly
  noiseGain.gain.setValueAtTime(volume * 1.5, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12 + (height * 0.03));

  noiseNode.connect(bandpass);
  bandpass.connect(noiseGain);
  noiseGain.connect(masterGain);
  
  noiseNode.start(now);
  noiseNode.stop(now + 0.4);
}

/**
 * Project 3D coordinates (x, y, z) to 2D Screen Space (screenX, screenY)
 * @param x World position X [-0.5, 0.5]
 * @param y Height displacement [-0.5, 0.5]
 * @param z World position Z [-0.5, 0.5]
 * @param yaw Rotation Angle around Y-axis (radians)
 * @param pitch Rotation Angle around X-axis (radians)
 * @param width Canvas Width
 * @param height Canvas Height
 * @param zoom Zoom Factor
 */
export function project3D(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  width: number,
  height: number,
  zoom: number = 0.8
): { x: number; y: number; depth: number } {
  // Yaw rotation (around visual vertical Y axis)
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const x1 = x * cosYaw - z * sinYaw;
  const z1 = x * sinYaw + z * cosYaw;

  // Pitch rotation (around visual horizontal X axis)
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  // Real y is pointing up, but canvas renders downwards
  const y2 = y * cosPitch - z1 * sinPitch;
  const z2 = y * sinPitch + z1 * cosPitch;

  // Center of projection
  const cx = width / 2;
  const cy = height / 2;

  // Perspective calculations
  const distance = 2.0; // View distance
  const perspectiveFactor = distance / (distance + z2);

  const screenX = cx + x1 * perspectiveFactor * (width * 0.45) * zoom;
  const screenY = cy - y2 * perspectiveFactor * (height * 0.45) * zoom; // inverted visual Y

  return {
    x: screenX,
    y: screenY,
    depth: z2, // useful to sort drawings for back-to-front painter's algorithm
  };
}

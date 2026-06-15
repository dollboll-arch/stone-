export interface StonePreset {
  id: string;
  name: string;
  radius: number; // grid radius of impact
  mass: number;   // amplitude multiplier
  label: string;  // Korean label
  description: string;
  sizeDesc: string;
  icon: string;
}

export interface WaterTheme {
  id: string;
  name: string;
  label: string;
  waterColor: string;     // base water fill (e.g. #0a4f5c)
  rippleColor: string;    // wave shadow color
  highlightColor: string; // wave specular highlights (light reflection)
  bgColor: string;        // background panel container color
  foamColor: string;      // splash foam color
}

export interface Particle {
  x: number;
  y: number;
  z: number; // height above water
  vx: number;
  vy: number;
  vz: number; // vertical velocity
  size: number;
  color: string;
  alpha: number;
  decay: number;
  gravity: number;
}

export interface WaveRecord {
  time: number;
  amplitude: number;
}

export interface FallenStone {
  id: string;
  targetX: number;
  targetY: number;
  currentZ: number; // Height above water
  initialZ: number; // Starting height
  speed: number;    // falling speed
  radius: number;   // size
  color: string;
  mass: number;
  isCustomShape?: boolean;
}

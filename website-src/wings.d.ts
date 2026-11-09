// Types for wings.js (shared by the website's 3D viewer and the launcher's Locker preview).
import type * as THREE from "three";

export type WingShape = { label: string; scale: number; spread: number; flap: number; period: number; tilt: number; up: number; back: number; pairs?: number };
export const WING_SHAPES: Record<"classic" | "butterfly" | "seraph" | "fairy" | "drake", WingShape>;
export function wingShape(id: string): "classic" | "butterfly" | "seraph" | "fairy" | "drake";
export function makeWings(id: string, url: string): Promise<{ group: THREE.Group; tick(now: number): void; dispose(): void } | null>;

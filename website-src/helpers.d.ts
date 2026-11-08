// Types for helpers.js (shared by the website's 3D viewer and the launcher's Locker preview).
import type * as THREE from "three";

export type Ear = { rows: string[]; thick: number; x: number; y: number; z: number; out: number; back: number; fallback: number; fixed?: boolean };
export const EARS: Record<string, Ear>;
export function earPalette(ear: Ear, color: number): [number, number, number, number];
export const SANTA: number[][];
export const CUSTOM_CAPES: Record<string, [number, number]>;
export function capeFrames(img: HTMLImageElement, n: number): HTMLCanvasElement[];
export function playCape(viewer: { loadCape: (src: HTMLCanvasElement, o?: { backEquipment?: "cape" | "elytra" }) => unknown }, img: HTMLImageElement, id: string, backEquipment?: "cape" | "elytra"): () => void;
export function auraColour(style: string, c: number, t: number, now: number): THREE.Color;
export function auraPoints(style: string, now: number, out: (x: number, y: number, z: number, size: number, bright: number, t: number) => void): void;
export function colourAt(c: number, t: number, now: number): THREE.Color;
export function glow(color: number, opacity?: number): THREE.MeshBasicMaterial;
export function makeHalo(style: string, color: number): THREE.Group;
export function makeHat(style: string, color: number): THREE.Group;

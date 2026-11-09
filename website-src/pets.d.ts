import type * as THREE from "three";
export function loadPet(id: string, base: string, left: boolean): Promise<{ group: THREE.Group; tick(now: number): void; dispose(): void } | null>;

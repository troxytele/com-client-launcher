export type VariantColor = { id: string; label: string; hex: string };
export type VariantGroup = { kind: string; main: string; name: string; colors: VariantColor[] };
export function groupOf(kind: string, id: string): VariantGroup | undefined;
export function isExtraColor(kind: string, id: string): boolean;
export function titleOf(kind: string, id: string, fallback: string): string;
export function shownColor(kind: string, main: string, worn: string): string;
export function idsOf(kind: string, id: string): string[];

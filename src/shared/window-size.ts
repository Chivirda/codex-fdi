export interface WindowSize { width: number; height: number }
export const DEFAULT_WINDOW_SIZE: Readonly<WindowSize> = { width: 380, height: 640 };
export const WINDOW_LIMITS = { minWidth: 320, minHeight: 300, maxWidth: 900, maxHeight: 1200 } as const;

/** Validate untrusted storage/messages and clamp to the supported integer dimensions. */
export function normalizeWindowSize(value: unknown, available?: WindowSize): WindowSize | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { width, height } = value as Partial<WindowSize>;
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  const maxWidth = available && Number.isFinite(available.width) && available.width > 0
    ? Math.max(WINDOW_LIMITS.minWidth, Math.min(WINDOW_LIMITS.maxWidth, Math.floor(available.width) - 32)) : WINDOW_LIMITS.maxWidth;
  const maxHeight = available && Number.isFinite(available.height) && available.height > 0
    ? Math.max(WINDOW_LIMITS.minHeight, Math.min(WINDOW_LIMITS.maxHeight, Math.floor(available.height) - 96)) : WINDOW_LIMITS.maxHeight;
  return {
    width: Math.max(WINDOW_LIMITS.minWidth, Math.min(maxWidth, Math.round(width))),
    height: Math.max(WINDOW_LIMITS.minHeight, Math.min(maxHeight, Math.round(height))),
  };
}

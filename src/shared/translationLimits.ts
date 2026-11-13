/** Shared by settings, page admission and the account-wide network limiter. */
export const TRANSLATION_CONCURRENCY = { min: 1, max: 8, default: 3 } as const
export const BATCH_MAX_TEXTS = { min: 1, max: 32, default: 8 } as const

function boundedInteger(value: number, limits: { min: number; max: number; default: number }): number {
  return Number.isFinite(value)
    ? Math.min(limits.max, Math.max(limits.min, Math.floor(value)))
    : limits.default
}

export const normalizeConcurrency = (value: number): number => boundedInteger(value, TRANSLATION_CONCURRENCY)
export const normalizeBatchMaxTexts = (value: number): number => boundedInteger(value, BATCH_MAX_TEXTS)

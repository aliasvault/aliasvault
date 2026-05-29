/**
 * Utility functions for password length slider with non-linear scaling.
 *
 * The slider uses a power curve to provide fine-grained control at lower values
 * (where most users operate, e.g., 12-32 chars) and coarser control at higher values
 * (64-256 chars).
 *
 * This makes it easy to select common password lengths while still allowing
 * very long passwords when needed.
 */

/** Minimum password length */
export const MIN_PASSWORD_LENGTH = 8;

/** Maximum password length */
export const MAX_PASSWORD_LENGTH = 256;

/** Slider minimum value (internal representation) */
export const SLIDER_MIN = 0;

/** Slider maximum value (internal representation) */
export const SLIDER_MAX = 100;

/**
 * Exponent for the power curve.
 * Higher values = more precision at lower lengths.
 * 2.0 gives a good balance where ~50% slider = ~70 chars
 */
const EXPONENT = 2.0;

/**
 * Convert a slider position (0-100) to an actual password length (8-256).
 * Uses a power curve for non-linear scaling.
 *
 * @param sliderValue - The slider position (0-100)
 * @returns The password length (8-256)
 */
export function sliderToLength(sliderValue: number): number {
  const normalized = Math.max(0, Math.min(1, sliderValue / SLIDER_MAX));
  const curved = Math.pow(normalized, EXPONENT);
  const length = MIN_PASSWORD_LENGTH + curved * (MAX_PASSWORD_LENGTH - MIN_PASSWORD_LENGTH);
  return Math.round(length);
}

/**
 * Convert a password length (8-256) to a slider position (0-100).
 * Inverse of sliderToLength.
 *
 * @param length - The password length (8-256)
 * @returns The slider position (0-100)
 */
export function lengthToSlider(length: number): number {
  const clampedLength = Math.max(MIN_PASSWORD_LENGTH, Math.min(MAX_PASSWORD_LENGTH, length));
  const normalized = (clampedLength - MIN_PASSWORD_LENGTH) / (MAX_PASSWORD_LENGTH - MIN_PASSWORD_LENGTH);
  const curved = Math.pow(normalized, 1 / EXPONENT);
  return curved * SLIDER_MAX;
}

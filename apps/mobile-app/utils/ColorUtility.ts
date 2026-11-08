/**
 * The solid color of `tint` laid over `base` at the given opacity (0 to 1); both colors are `#rrggbb`.
 */
export function blendColors(base: string, tint: string, opacity: number): string {
  /**
   * The red, green and blue channel of a `#rrggbb` color.
   */
  const channels = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const [baseChannels, tintChannels] = [channels(base), channels(tint)];
  return '#' + baseChannels.map((value, i) => Math.round(value + (tintChannels[i] - value) * opacity).toString(16).padStart(2, '0')).join('');
}

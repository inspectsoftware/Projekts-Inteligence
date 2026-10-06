import { BROWSER_ORIGINS, FRAME_ORIGINS, IMAGE_ORIGINS, MEDIA_ORIGINS } from './origins'

/**
 * Content-Security-Policy for every response. The map fetches tiles, glyphs and
 * TileJSON with fetch(), so tile hosts belong in connect-src as well as img-src.
 */
export function buildCsp(origins: readonly string[] = BROWSER_ORIGINS): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    // The boot screen is an inline <style>, and the map sets inline style attributes.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...origins, ...IMAGE_ORIGINS],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...origins, ...MEDIA_ORIGINS],
    // blob: because an HLS player hands the video element a MediaSource URL.
    'media-src': ["'self'", 'blob:', ...MEDIA_ORIGINS],
    'frame-src': FRAME_ORIGINS.length > 0 ? [...FRAME_ORIGINS] : ["'none'"],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  }
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}

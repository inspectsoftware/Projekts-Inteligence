/**
 * The server's clock, as seen from this browser. Entity timestamps are on the server's
 * clock, so dead reckoning has to use it too: a browser clock that is a minute off
 * would otherwise draw every aircraft a dozen kilometres from where it is.
 *
 * Tracked against performance.now(), which keeps ticking evenly even if the
 * computer's clock is changed while the page is open.
 */
let serverAtSync = Date.now()
let perfAtSync = performance.now()
let bestRoundTrip = Infinity

export function serverNow(): number {
  return serverAtSync + (performance.now() - perfAtSync)
}

/**
 * Feed one request's timing in. The server stamped `serverTime` somewhere between
 * `sentAt` and `receivedAt` (both from performance.now()); the midpoint is the best guess.
 */
export function observeServerTime(serverTime: number, sentAt: number, receivedAt: number): void {
  const roundTrip = receivedAt - sentAt
  // Slow round trips say little about where in the interval the stamp was taken.
  if (roundTrip > bestRoundTrip + 100) {
    bestRoundTrip += 5
    return
  }
  bestRoundTrip = Math.min(bestRoundTrip, roundTrip)
  serverAtSync = serverTime
  perfAtSync = (sentAt + receivedAt) / 2
}

/** How long the splash's eye takes to open, look around and close (index.html). */
const SPLASH_MS = 3400

let leaving = false

/**
 * Lets go of the splash from index.html: once the eye has closed, never mid-look, the page zooms
 * in through it. Safe to call more than once.
 */
export function finishBoot(): void {
  const boot = document.getElementById('boot')
  if (!boot || leaving) return
  leaving = true
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // performance.now() counts from navigation start, which is when the animation began.
  const wait = still ? 0 : Math.max(0, SPLASH_MS - performance.now())
  setTimeout(() => {
    boot.classList.add('done')
    setTimeout(() => boot.remove(), 650)
  }, wait)
}

import { type RefObject, useEffect, useState, useSyncExternalStore } from 'react'

/**
 * True while the element is laid out inside the viewport: scrolled into view, in a window that
 * is not collapsed. False until the browser has had its first look.
 */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => setInView(entries[entries.length - 1].isIntersecting))
    observer.observe(ref.current!)
    return () => observer.disconnect()
  }, [ref])
  return inView
}

function subscribeTab(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

/** In view, in a tab that is showing: nothing fetches a new frame for a picture nobody can see. */
export function useOnScreen(ref: RefObject<Element | null>): boolean {
  const inView = useInView(ref)
  return useSyncExternalStore(subscribeTab, () => !document.hidden) && inView
}

/** The time, read again every `seconds` for as long as `active`: what makes a still fetch its next frame. */
export function useTicker(seconds: number | undefined, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!seconds || !active) return
    const tick = () => setNow(Date.now())
    // Once straight away too: a picture coming back into view should not sit on an old frame for another period.
    tick()
    const timer = setInterval(tick, seconds * 1000)
    return () => clearInterval(timer)
  }, [seconds, active])
  return now
}

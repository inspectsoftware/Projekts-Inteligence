/** Fades out the static boot screen from index.html. Safe to call more than once. */
export function finishBoot(): void {
  const boot = document.getElementById('boot')
  if (!boot || boot.classList.contains('done')) return
  boot.classList.add('done')
  setTimeout(() => boot.remove(), 700)
}

/** The politics page has its own address, so it can be bookmarked, shared and left open in a tab. */
export const POLITICS_HREF = '/?politics'
export const onPoliticsPage = () => new URLSearchParams(window.location.search).has('politics')

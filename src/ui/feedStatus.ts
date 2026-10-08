import type { FeedStatus } from '../../shared/feeds'
import { t } from '../i18n'

export const STATUS_DOT: Record<FeedStatus, string> = {
  ok: 'bg-ok',
  stale: 'bg-warn',
  error: 'bg-danger',
  idle: 'bg-fg-mute',
  'needs-key': 'bg-fg-mute',
}

export const STATUS_TEXT: Record<FeedStatus, string> = {
  ok: t('Live'),
  stale: t('Delayed: showing the last good data'),
  error: t('Feed unavailable'),
  idle: t('Waiting for data'),
  'needs-key': t('Needs an API key'),
}

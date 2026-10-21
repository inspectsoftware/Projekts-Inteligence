import { t } from '../../i18n'
import type { InspectorModel } from '../../layers/types'
import { formatLat, formatLon } from '../../lib/coords'
import { showWhen } from '../../runtime/place'
import type { CityHit } from './layer'
import { attributeStrings } from './mesh'
import type { BuildingField } from './types'

type Fields = Partial<Record<BuildingField, string>>

/**
 * What the cadastre says of the clicked building, read from its leaf's attributes: one small file
 * per field, each listing the leaf's buildings in the order its geometry does.
 */
async function readFields({ leaf, feature }: CityHit): Promise<Fields> {
  const { layer, resource } = leaf
  const entries = await Promise.all(
    Object.entries(layer.fields ?? {}).map(async ([field, key]) => {
      const res = await fetch(`${layer.url}/nodes/${resource}/attributes/${key}/0`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // The city pads its addresses: "Laipu iela   7".
      const value = attributeStrings(await res.arrayBuffer())?.[feature]?.replace(/\s+/g, ' ').trim()
      return [field, value || undefined]
    }),
  )
  return Object.fromEntries(entries) as Fields
}

function describe(fields: Fields, { leaf, lon, lat }: CityHit): InspectorModel {
  const rows: [string, string | undefined][] = [
    // A date, but only its year means anything: most are the 1st of January.
    [t('In use since'), /^\d{4}/.exec(fields.exploitstartdate ?? '')?.[0]],
    [t('Cadastral designation'), fields.cadastrename],
    [t('Property'), fields.propertyname],
    [t('Property cadastral number'), fields.propertycadastrenumber],
    [t('Neighbourhood'), leaf.layer.name],
    [t('Position'), `${formatLat(lat)}  ${formatLon(lon)}`],
  ]
  return {
    kicker: t('Building'),
    title: fields.address ?? t('No address'),
    subtitle: fields.mainusetype,
    badges: [],
    rows: rows.flatMap(([label, value]) => (value ? [{ label, value }] : [])),
    links: [],
  }
}

/** Shows a building of Rīga's city model in the inspector, and what the cadastre says of it once read. */
export function showBuilding(hit: CityHit): void {
  const asked: InspectorModel = { ...describe({}, hit), title: t('Building') }
  showWhen(asked, hit.lon, hit.lat, readFields(hit).then((fields) => describe(fields, hit)))
}

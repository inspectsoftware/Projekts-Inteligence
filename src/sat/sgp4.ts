/**
 * The parts of satellite.js this app uses, imported from the files that hold them.
 *
 * The package's own entry point also re-exports a multi-threaded WebAssembly build.
 * Merely importing from 'satellite.js' drags that into the bundle, where it breaks
 * the production build (it spawns workers and uses Node-only imports) and would need
 * a looser Content-Security-Policy to run. The plain JavaScript propagator is more
 * than fast enough for a few hundred satellites, so only that is pulled in.
 */
export { json2satrec } from '../../node_modules/satellite.js/dist/io.js'
export { gstime, propagate } from '../../node_modules/satellite.js/dist/propagation.js'
export type { SatRec } from '../../node_modules/satellite.js/dist/propagation/SatRec.js'
export {
  degreesLat,
  degreesLong,
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
} from '../../node_modules/satellite.js/dist/transforms.js'

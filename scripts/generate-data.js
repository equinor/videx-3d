/**
 * This script is used to map data from very specific source files and write to /public/data.
 * It is not indended to be used for importing custom/general data.
 *
 * Data is collected from various endpoints and saved as json files in the
 * /public/data folder. They consist of:
 *
 * config: { orgin: [easting, northing], stratColumn: "{id}" }
 *
 * wellbore headers from SMDA: /wellheaders
 *
 * position logs from SMDA: /wellbore-survey-samples (projection: wellbore_uuid, md, tvd, delta_easting, delta_northing)
 *
 * strat column from SMDA: /strat-units?strat_column_uuid={id}
 *
 * picks from SMDA: /wellbore-picks?field_identifier={field name}&interpreter=STAT
 *
 * casings from SSDL: /Field/{fieldUuid}/casings&normalized-data=true
 *
 * completion from SSDL: /Field/{fieldUuid}/completions&normalized-data=true
 *
 * perforations from SSDL: /Field/{fieldUuid}/perforations&normalized-data=true
 *
 * surface meta data from Surface API (SUMO/FMU):
 *  > SUMO: /sumo/{caseId}/surfaces
 *  > FMU: /model/{modelId}/surfaces
 *
 * surface irapbin files from Surface API (SUMO/FMU):
 *  > SUMO: /download/sumo/{caseid}/{surfaceid}
 *  > FMU: /download/fmu/{modelid}/{surfaceid}
 *
 * !!!IMPORTANT: surface irapbin files must be put in the /public/data/surfaces folder, named by surface id!
 *
 * node scripts/generate-data --input private/_troll && node scripts/generate-story-args
 */

import minimist from 'minimist'
import fs from 'node:fs'
import { rimrafSync } from 'rimraf'
import { transformCasings } from './transformations/transformCasings.js'
import { transformCompletion } from './transformations/transformCompletion.js'
import { transformPerforations } from './transformations/transformPerforations.js'
import { transformPicks } from './transformations/transformPicks.js'
import { transformPositionLogs } from './transformations/transformPositionLogs.js'
import { transformStratColumns } from './transformations/transformStratColumns.js'
import { transformSurfaceFiles } from './transformations/transformSurfaceFiles.js'
import { transformSurfaceMeta } from './transformations/transformSurfaceMeta.js'
import { transformWellboreHeaders } from './transformations/transformWellboreHeaders.js'
import { verify } from './utils.js'

const args = minimist(process.argv.slice(2))

const inPath = ((args.input || '.') + '/').replace('//', '/')
const outPath = ((args.output || './public/data') + '/').replace('//', '/')

const fileNames = [
  'config',
  'wellbore-headers',
  'position-logs',
  'casings',
  'completion',
  'perforations',
  'strat-columns',
  'picks',
  'surface-meta',
]

const input = new Object(null)
const output = new Object(null)

console.info('Generating data...')

/// read input data from source files
for (let i = 0; i < fileNames.length; i++) {
  const name = fileNames[i]
  const fileName = name + '.json'
  try {
    console.info('> reading source file: ' + inPath + fileName)
    const fileData = fs.readFileSync(inPath + fileName)
    input[name] = JSON.parse(fileData.toString())
  } catch {
    console.warn(fileName + ' was not found in ' + inPath)
    input[name] = null
  }
}

/// verify we have required data
verify(input, 'config', 'wellbore-headers', 'position-logs')

output['config'] = input['config'] // pass through

console.info('> cleaning/preparing destination folder: ' + outPath)
if (fs.existsSync(outPath)) {
  rimrafSync(outPath)
}
fs.mkdirSync(outPath)

/// transformations
console.info('> transforming wellbore headers')
transformWellboreHeaders(input, output)
console.info('> transforming position logs')
transformPositionLogs(input, output)
console.info('> transforming casing data')
transformCasings(input, output)
console.info('> transforming completion data')
transformCompletion(input, output)
console.info('> transforming perforation data')
transformPerforations(input, output)
console.info('> transforming strat columns')
transformStratColumns(input, output)
console.info('> transforming pick data')
transformPicks(input, output)
console.info('> transforming surface meta data')
transformSurfaceMeta(input, output)

/// write transformed data to output path
for (const name in output) {
  const data = output[name]
  const fileName = name + '.json'
  console.info('> writing target file: ' + outPath + fileName)
  fs.writeFileSync(outPath + fileName, JSON.stringify(data))
}

/// transform surface values from binary files
if (output['surface-meta']) {
  const meta = output['surface-meta']
  transformSurfaceFiles(meta, inPath, outPath)
}

console.info('Generate data complete!')
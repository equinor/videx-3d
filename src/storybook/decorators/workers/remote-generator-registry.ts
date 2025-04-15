import { expose } from 'comlink'

import { surfaceGeometry, surfaceTextures } from '../../../components/Surfaces/surface-defs'
import { basicTrajectory } from '../../../components/Wellbores/BasicTrajectory/basic-trajectory-defs'
import { casingAnnotations } from '../../../components/Wellbores/Casings/CasingAnnotations/casing-annotations-defs'
import { casings } from '../../../components/Wellbores/Casings/casings-defs'
import { completionTools } from '../../../components/Wellbores/CompletionTools/completion-tools-defs'
import { completionToolAnnotations } from '../../../components/Wellbores/CompletionTools/CompletionAnnotations/completion-annotations-defs'
import { depthMarkers } from '../../../components/Wellbores/DepthMarkers/depth-markers-defs'
import { perforationSymbols } from '../../../components/Wellbores/Perforations/perforations-defs'
import { perimeterGeometry } from '../../../components/Wellbores/Perimeter/perimeter-defs'
import { pickSymbols } from '../../../components/Wellbores/Picks/picks-defs'
import { positionMarkers } from '../../../components/Wellbores/PositionMarkers/position-markers-defs'
import { shoeSymbols } from '../../../components/Wellbores/Shoes/shoes-defs'
import { tubeTrajectory } from '../../../components/Wellbores/TubeTrajectory/tube-geometry-defs'
import { wellboreBounds } from '../../../components/Wellbores/WellboreBounds/wellbore-bounds-defs'
import { wellboreFormationColumn } from '../../../components/Wellbores/WellboreFormationColumn/wellbore-formation-column-defs'
import { wellboreLabel } from '../../../components/Wellbores/WellboreLabel/wellbore-label-defs'

import {
  calculateWellboreBounds,
  generateBasicTrajectory,
  generateCasingAnnotations,
  generateCasings,
  generateCompletionToolAnnotations,
  generateCompletionTools,
  generateDepthMarkers,
  generatePerforations,
  generatePerimeterGeometry,
  generatePicks,
  generatePositionMarkers,
  generateShoes,
  generateSurfaceGeometry,
  generateSurfaceTexturesData,
  generateTubeTrajectory,
  generateWellboreFormationColumnGeometries,
  generateWellboreLabel,
} from '../../../generators'

import { GeneratorRegistry } from '../../../sdk'

const registry = new GeneratorRegistry()

registry.add(wellboreBounds, calculateWellboreBounds)
registry.add(basicTrajectory, generateBasicTrajectory)
registry.add(tubeTrajectory, generateTubeTrajectory)
registry.add(completionTools, generateCompletionTools)
registry.add(casings, generateCasings)
registry.add(perimeterGeometry, generatePerimeterGeometry)
registry.add(casingAnnotations, generateCasingAnnotations)
registry.add(completionToolAnnotations, generateCompletionToolAnnotations)
registry.add(shoeSymbols, generateShoes)
registry.add(pickSymbols, generatePicks)
registry.add(depthMarkers, generateDepthMarkers)
registry.add(wellboreLabel, generateWellboreLabel)
registry.add(surfaceGeometry, generateSurfaceGeometry)
registry.add(surfaceTextures, generateSurfaceTexturesData)
registry.add(perforationSymbols, generatePerforations)
registry.add(positionMarkers, generatePositionMarkers)
registry.add(wellboreFormationColumn, generateWellboreFormationColumnGeometries)

expose(registry)

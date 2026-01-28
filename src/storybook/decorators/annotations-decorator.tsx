import { Annotations, getAnnotationPosition } from '../../components/Annotations'
import { AnnotationsLayer } from '../../components/Annotations/AnnotationsLayer'
import { AnnotationComponentProps } from '../../components/Annotations/types'
import { CasingLabel } from '../../components/Wellbores/Casings/CasingAnnotations/CasingLabel'
import { DepthMarkerLabel } from '../../components/Wellbores/DepthMarkers/DepthMarkerLabel'
import { FormationMarkerLabel } from '../../components/Wellbores/FormationMarkers/FormationMarkerLabel'
import { WellboreAnnotationLabel } from '../../components/Wellbores/WellboreLabel/WellboreAnnotationLabel'
import { CameraFocusAtPointEvent } from '../../events/camera-events'

export const AnnotationsDecorator = (Story: any) => (
  <>
    <Annotations maxVisible={500}>
      <AnnotationsLayer
        id="casings"
        name="Casings"
        anchorSize={5}
        anchorColor='cyan'
        distanceFactor={150}
        labelOffset={100}
        minDistance={10}
        maxDistance={8000}
        priority={2}
        anchorOcclusionRadius={10}
        labelComponent={CasingLabel}
        onClick={(annotation: AnnotationComponentProps) => {
          dispatchEvent(new CameraFocusAtPointEvent({ point: getAnnotationPosition(annotation), distance: 300 }))
        }}
      />
      <AnnotationsLayer
        id="completion"
        name="Completion"
        priority={1}
        anchorSize={4}
        distanceFactor={150}
        labelOffset={50}
        minDistance={10}
        maxDistance={5000}
        anchorOcclusionRadius={10}
        onClick={(annotation: AnnotationComponentProps) => {
          dispatchEvent(new CameraFocusAtPointEvent({ point: getAnnotationPosition(annotation), distance: 200 }))
        }}
      />
      <AnnotationsLayer
        id="shoes"
        name="Shoes"
        priority={3}
        anchorSize={4}
        distanceFactor={150}
        labelOffset={50}
        minDistance={10}
        maxDistance={5000}
        anchorOcclusionRadius={10}
        onClick={(annotation: AnnotationComponentProps) => {
          dispatchEvent(new CameraFocusAtPointEvent({ point: getAnnotationPosition(annotation), distance: 200 }))
        }}
      />
      <AnnotationsLayer
        id="formation-markers"
        name="Formation Markers"
        priority={2}
        anchorSize={2}
        distanceFactor={200}
        labelOffset={100}
        minDistance={10}
        maxDistance={500}
        labelComponent={FormationMarkerLabel}
        anchorOcclusionRadius={10}
        onClick={(annotation: AnnotationComponentProps) => {
          dispatchEvent(new CameraFocusAtPointEvent({ point: getAnnotationPosition(annotation), distance: 200 }))
        }}
      />
      <AnnotationsLayer
        id="depth-markers"
        name="Depth Markers"
        priority={10}
        anchorSize={2}
        anchorColor='#777'
        distanceFactor={1000}
        labelOffset={25}
        minDistance={10}
        maxDistance={8000}
        anchorOcclusionRadius={10}
        labelComponent={DepthMarkerLabel}
        onClick={(annotation: AnnotationComponentProps) => {
          dispatchEvent(new CameraFocusAtPointEvent({ point: getAnnotationPosition(annotation), distance: 200 }))
        }}
      />
      <AnnotationsLayer
        id="wellbore-labels"
        name="Wellbore Labels"
        priority={4}
        anchorSize={5}
        anchorColor='cyan'
        connectorWidth={1.5}
        distanceFactor={1000}
        labelOffset={50}
        minDistance={1}
        maxDistance={10000}
        anchorOcclusionRadius={20}
        labelComponent={WellboreAnnotationLabel}
        onClick={(annotation: AnnotationComponentProps) => {
          dispatchEvent(new CameraFocusAtPointEvent({ point: getAnnotationPosition(annotation), distance: 500 }))
        }}
      />
      <AnnotationsLayer
        id="test"
        name="test"
        priority={99}
        anchorSize={10}
        anchorColor="red"
        distanceFactor={1000}
        maxDistance={100}
        anchorOcclusionRadius={999999}
      />
    </Annotations>
    <Story />
  </>
)

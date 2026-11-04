// The two markers a map draws, as its layers draw them and as its buttons and readouts show
// what they are about: the camera, an arrow; and its target, a crosshair. Drawn about (0, 0),
// pointing up, for an SVG.

type IconProps = {
  /** its length in pixels */
  size: number;
  color: string;
};

/** The camera: an arrow, pointing up. */
export const GeoMapCameraIcon = ({ size, color }: IconProps) => (
  <path
    d={`M0 ${-size * 0.6} L${size * 0.45} ${size * 0.4} L0 ${size * 0.15} L${-size * 0.45} ${size * 0.4} Z`}
    fill={color}
    stroke="#000"
    strokeOpacity={0.7}
    strokeWidth={1}
    strokeLinejoin="round"
  />
);

/** What the camera looks at: a ring with a cross through it. */
export const GeoMapTargetIcon = ({ size, color }: IconProps) => {
  const r = size * 0.32;
  const reach = size * 0.55;
  const lines = `M${-reach} 0 L${-r * 0.4} 0 M${r * 0.4} 0 L${reach} 0 M0 ${-reach} L0 ${-r * 0.4} M0 ${r * 0.4} L0 ${reach}`;
  return (
    <>
      {/* a dark edge under the strokes, so they read on light ground too */}
      <circle
        r={r}
        fill="none"
        stroke="#000"
        strokeOpacity={0.6}
        strokeWidth={3}
      />
      <path
        d={lines}
        fill="none"
        stroke="#000"
        strokeOpacity={0.6}
        strokeWidth={3}
      />
      <circle r={r} fill="none" stroke={color} strokeWidth={1.5} />
      <path d={lines} fill="none" stroke={color} strokeWidth={1.5} />
    </>
  );
};

/** A marker's icon in an SVG of its own, `box` pixels square: for a button or a readout. */
export const GeoMapMarkerIcon = ({
  marker,
  box,
  size,
  color = '#ffffff',
}: {
  marker: 'camera' | 'target';
  box: number;
  size: number;
  color?: string;
}) => (
  <svg
    width={box}
    height={box}
    viewBox={`${-box / 2} ${-box / 2} ${box} ${box}`}
    style={{ display: 'block' }}
  >
    {marker === 'target' ? (
      <GeoMapTargetIcon size={size} color={color} />
    ) : (
      <GeoMapCameraIcon size={size} color={color} />
    )}
  </svg>
);

/** A folded map: the face of a closed map's button. */
export const GeoMapIcon = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" style={{ display: 'block' }}>
    <path
      d="M1.5 3.5 L5.5 2 L10.5 3.5 L14.5 2 V12.5 L10.5 14 L5.5 12.5 L1.5 14 Z M5.5 2 V12.5 M10.5 3.5 V14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinejoin="round"
    />
  </svg>
);

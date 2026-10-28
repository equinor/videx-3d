// The two markers a minimap draws, as the layers draw them on the map and as its centre
// button shows what it is centred on: the camera, an arrow; and its target, a crosshair.
// Drawn about (0, 0), pointing up, for an SVG.

type IconProps = {
  /** its length in pixels */
  size: number;
  color: string;
};

/** The camera: an arrow, pointing up. */
export const MinimapCameraIcon = ({ size, color }: IconProps) => (
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
export const MinimapTargetIcon = ({ size, color }: IconProps) => {
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

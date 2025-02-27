/**
 * Position log are expected to be a strided array of values including:
 * - dx: UTM easting offset relative to the head position
 * - dy: The TVD depth relative to mean sea level (Msl)
 * - dz: UTM northing offset relative to the head position
 * - md: Measured depth relative to mean sea level (Msl)
 * 
 * The stride is then 4 values per log entry:
 * [dx0, dy0, dz0, md0, dx1, dy1, dz1, md1, ..., dx(n - 1), dy(n-1), dz(n-1), md(n-1)]
 * 
 * The measured top is then positionlog[3]
 * The measured bottom is then positionlog[positionlog.length - 1]
 * 
 * The position log is represented in this way for optimimalization reasons.
 * 
 */
export type PositionLog = Float32Array
type Props = {
  depth: number
  color: string
}

export const DepthReadout = ({ depth, color }: Props) => {
  return (
    <div style={{
      textAlign: 'center',
      fontSize: '90%',
      fontFamily: 'monospace',
      color
    }}>
      { depth.toFixed(1) } mD MSL
    </div>
  )
}
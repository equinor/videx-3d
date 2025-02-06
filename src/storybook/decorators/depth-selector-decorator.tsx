import { DepthSelector } from '../../components/Html/DepthSelector'

const style: any = {
  display: 'flex',
  flexDirection: 'row',
  position: 'absolute',
  height: 'auto',
  bottom: 0,
  top: 0,
  left: 0,
  right: 0,
}

export const DepthSelectorDecorator = (Story: any) => (
  <div style={style}>
    <DepthSelector />
    <Story />
  </div>
)
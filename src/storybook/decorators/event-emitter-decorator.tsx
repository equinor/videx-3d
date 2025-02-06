import { EventEmitter } from '../../components/Handlers/EventEmitter/EventEmitter'

export const EventEmitterDecorator = (Story: any) => (
  <EventEmitter>
    <Story />
  </EventEmitter>
)

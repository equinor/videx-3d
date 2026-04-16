import { EventEmitter } from '../../components/EventEmitter/EventEmitter';

export const EventEmitterDecorator = (Story: any) => (
  <EventEmitter>
    <Story />
  </EventEmitter>
);

import { nanoid } from 'nanoid';

export function generateBookingToken() {
  return nanoid(22);
}

import type { Entity } from './entity.js';

export interface Branch extends Entity {
  name: string;
  /** Short human-readable code, unique across branches (e.g. `CENTRAL`). */
  code: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
}

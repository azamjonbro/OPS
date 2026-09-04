import type { Entity } from './entity.js';

export interface Category extends Entity {
  name: string;
  description: string | null;
  /** Id of the parent category, or `null` for a top-level one. */
  parent: string | null;
  isActive: boolean;
}

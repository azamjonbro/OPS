import type { Entity } from './entity.js';

export interface Category extends Entity {
  name: string;
  description: string | null;
  /** Parent category, or `null` for a top-level one. */
  parentId: string | null;
  isActive: boolean;
}

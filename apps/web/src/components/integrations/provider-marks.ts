import type { IntegrationProvider } from '@hadiya/shared';

/**
 * How each provider is drawn.
 *
 * Kept as path data rather than as images so a tile has no network dependency
 * and inherits the current text colour — which is what lets the same mark read
 * correctly on a card, in a dialog and on a disabled row.
 *
 * The two Hadiya vouches for get colour; a custom MCP server gets the neutral
 * tint, and the difference is deliberate rather than decorative: a server the
 * user brought should not wear the same badge as one Hadiya wrote a client for.
 */
export const PROVIDER_ICONS: Record<IntegrationProvider, string> = {
  // A till.
  billz: 'M3 3h2l3 12h10l3-8H7M9 21h.01M18 21h.01',
  // A page with lines.
  notion: 'M5 3h9l5 5v13H5zM14 3v5h5M8 13h8M8 17h5',
  // A plug and socket.
  custom_mcp:
    'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
};

export const PROVIDER_TINTS: Record<IntegrationProvider, string> = {
  billz: 'bg-brand-50 text-brand-700',
  notion: 'bg-surface-muted text-ink-900',
  custom_mcp: 'bg-surface-muted text-ink-500',
};

/**
 * Who produced a message.
 *
 * `tool` messages hold the result of a tool the assistant asked for, so a
 * conversation can be replayed exactly as the model saw it.
 */
export const MESSAGE_ROLES = ['system', 'user', 'assistant', 'tool'] as const;

export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** `archived` hides a conversation from the list without destroying its history. */
export const CONVERSATION_STATUSES = ['active', 'archived'] as const;

export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/** How a tool call ended, kept so a failed call is visible in the transcript. */
export const TOOL_CALL_STATUSES = ['succeeded', 'failed'] as const;

export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];

/** Longest title generated from a first message before it is cut short. */
export const CONVERSATION_TITLE_MAX_LENGTH = 60;

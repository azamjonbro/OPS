import {
  PLATFORM_PROFILES,
  type ContentPlatform,
  type ContentPreferences,
  type ContentType,
} from '@hadiya/shared';

import type { ContentItemDocument } from '../content-item.model.js';

/**
 * What the model is told before it writes anything.
 *
 * Three things go into every brief and they are kept separate on purpose:
 * *who the user is* (their stored preferences), *what the platform expects*,
 * and *what the business actually sells*. The last of those is passed in by the
 * caller rather than read here — the content engine never queries products or
 * sales itself, because then "generate a plan" would silently mean "and also go
 * and read the shop's figures", and the assistant could no longer choose what
 * the plan should be based on.
 */

/** How the person wants to be written for, rendered for a prompt. */
export const describePreferences = (preferences: ContentPreferences): string[] => {
  const lines: string[] = [];

  if (preferences.language) {
    lines.push(`Write in ${preferences.language}.`);
  }

  if (preferences.tone) {
    lines.push(`Tone: ${preferences.tone}.`);
  }

  if (preferences.style) {
    lines.push(`Style: ${preferences.style}.`);
  }

  if (preferences.brandVoice) {
    lines.push(`Brand voice: ${preferences.brandVoice}.`);
  }

  if (preferences.audience) {
    lines.push(`Audience: ${preferences.audience}.`);
  }

  return lines;
};

export const describePlatform = (platform: ContentPlatform): string[] => {
  const profile = PLATFORM_PROFILES[platform];

  return [
    `Platform: ${profile.label}.`,
    `Aim for about ${profile.captionTargetChars} characters of caption.`,
    profile.hashtagTarget === 0
      ? 'This platform does not use hashtags; return an empty list.'
      : `Use around ${profile.hashtagTarget} hashtags, without the # symbol.`,
    `Content types that suit it: ${profile.typicalTypes.join(', ')}.`,
  ];
};

/** The rules that apply to every structured request. */
const OUTPUT_RULES = [
  'Reply with JSON only. No explanation, no markdown fence, no text before or after it.',
  'Every field in the requested shape is required unless it is described as optional.',
  'Never invent a product, a price, a discount or a date that you were not given.',
];

export interface StructuredBrief {
  /** The system message: the role and the rules. */
  system: string;
  /** The user message: the task and its shape. */
  user: string;
}

export interface PlanBriefInput {
  platform: ContentPlatform;
  preferences: ContentPreferences;
  days: number;
  startDate: string;
  /** What the plan is for, in the user's words. */
  brief: string;
  /** Figures the assistant gathered first — never read by this module. */
  businessContext?: string | undefined;
  /** Restricts the content types, when the user asked for something specific. */
  contentTypes?: readonly ContentType[] | undefined;
}

const systemPrompt = (extra: string[] = []): string =>
  [
    'You are the content strategist for Hadiya, a retail business in Uzbekistan.',
    'You write social content that a small shop can actually produce and post.',
    ...extra,
    ...OUTPUT_RULES,
  ].join('\n');

export const buildPlanBrief = (input: PlanBriefInput): StructuredBrief => {
  const shape = [
    '{',
    '  "title": string,',
    '  "description": string,',
    '  "items": [',
    '    {',
    '      "dayOffset": integer, // 0 is the first day of the plan',
    '      "contentType": string,',
    '      "title": string,',
    '      "idea": string,       // what to shoot or show, for whoever produces it',
    '      "caption": string,    // the copy to post, ready to use',
    '      "callToAction": string,',
    '      "hashtags": string[]  // no # symbol',
    '    }',
    '  ]',
    '}',
  ].join('\n');

  return {
    system: systemPrompt(describePreferences(input.preferences)),
    user: [
      `Build a ${input.days}-day content plan starting ${input.startDate}.`,
      `Brief: ${input.brief}`,
      ...describePlatform(input.platform),
      input.contentTypes && input.contentTypes.length > 0
        ? `Use only these content types: ${input.contentTypes.join(', ')}.`
        : '',
      `Produce exactly ${input.days} items, one per day, with dayOffset 0 to ${input.days - 1}.`,
      input.businessContext
        ? `Base the plan on this business data, and refer to real products by name:\n${input.businessContext}`
        : '',
      '',
      'Return exactly this JSON shape:',
      shape,
    ]
      .filter(Boolean)
      .join('\n'),
  };
};

export interface CaptionBriefInput {
  platform: ContentPlatform;
  preferences: ContentPreferences;
  /** What the post is about. */
  topic: string;
  contentType?: ContentType | undefined;
  /** An existing caption to work from, for "shorten this" or "make it warmer". */
  existingCaption?: string | undefined;
  /** The change asked for, in the user's words. */
  instruction?: string | undefined;
  businessContext?: string | undefined;
}

export const buildCaptionBrief = (input: CaptionBriefInput): StructuredBrief => ({
  system: systemPrompt(describePreferences(input.preferences)),
  user: [
    input.existingCaption
      ? 'Rewrite the caption below. Keep what the user already liked about it and change only what was asked.'
      : 'Write a caption for this post.',
    `Topic: ${input.topic}`,
    input.contentType ? `Content type: ${input.contentType}.` : '',
    ...describePlatform(input.platform),
    input.existingCaption ? `\nCurrent caption:\n${input.existingCaption}` : '',
    input.instruction ? `\nWhat to change: ${input.instruction}` : '',
    input.businessContext ? `\nBusiness data:\n${input.businessContext}` : '',
    '',
    'Return exactly this JSON shape:',
    '{ "caption": string, "callToAction": string, "hashtags": string[] }',
  ]
    .filter(Boolean)
    .join('\n'),
});

export interface IdeasBriefInput {
  platform: ContentPlatform;
  preferences: ContentPreferences;
  topic: string;
  count: number;
  businessContext?: string | undefined;
}

export const buildIdeasBrief = (input: IdeasBriefInput): StructuredBrief => ({
  system: systemPrompt(describePreferences(input.preferences)),
  user: [
    `Give ${input.count} distinct content ideas about: ${input.topic}`,
    ...describePlatform(input.platform),
    'Each idea must stand on its own — no two variations of the same post.',
    input.businessContext ? `\nBusiness data:\n${input.businessContext}` : '',
    '',
    'Return exactly this JSON shape:',
    '{ "ideas": [ { "title": string, "idea": string, "contentType": string, "angle": string, "hashtags": string[] } ] }',
  ]
    .filter(Boolean)
    .join('\n'),
});

export interface RegenerateBriefInput {
  item: ContentItemDocument;
  preferences: ContentPreferences;
  /** What to change. Absent means "write it again, better". */
  instruction?: string | undefined;
  businessContext?: string | undefined;
}

/**
 * Rewriting one item.
 *
 * The current item is included in full and the model is told to keep what was
 * not mentioned. That is what makes "captionni qisqartir" change the caption
 * and leave the idea, the day and the type alone — the alternative, throwing
 * the item away and generating a fresh one, loses work the person approved.
 */
export const buildRegenerateBrief = (input: RegenerateBriefInput): StructuredBrief => ({
  system: systemPrompt(describePreferences(input.preferences)),
  user: [
    'Rewrite one item of a content plan.',
    'Change only what the instruction asks for. Keep everything else as it is.',
    '',
    'Current item:',
    JSON.stringify(
      {
        title: input.item.title,
        contentType: input.item.contentType,
        idea: input.item.idea,
        caption: input.item.caption,
        callToAction: input.item.callToAction,
        hashtags: input.item.hashtags,
      },
      null,
      2,
    ),
    ...describePlatform(input.item.platform),
    input.instruction ? `\nInstruction: ${input.instruction}` : '\nInstruction: improve it.',
    input.businessContext ? `\nBusiness data:\n${input.businessContext}` : '',
    '',
    'Return exactly this JSON shape:',
    '{ "title": string, "idea": string, "contentType": string, "caption": string, "callToAction": string, "hashtags": string[] }',
  ]
    .filter(Boolean)
    .join('\n'),
});

/** Appended when a first attempt came back malformed, so the retry is informed. */
export const buildRepairInstruction = (issues: string[]): string =>
  [
    'Your previous reply could not be used.',
    issues.length > 0 ? `Problems:\n- ${issues.join('\n- ')}` : 'It was not valid JSON.',
    'Reply again with JSON only, matching the shape exactly.',
  ].join('\n');

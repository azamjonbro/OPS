import {
  ASPECT_RATIO_GUIDANCE,
  IMAGE_ASPECT_RATIOS,
  IMAGE_MAX_COUNT,
  IMAGE_PROMPT_MAX_LENGTH,
  IMAGE_PROMPT_MIN_LENGTH,
  IMAGE_QUALITIES,
  IMAGE_STYLES,
  type ImageAspectRatio,
  type ImageQuality,
  type ImageStyle,
} from '@hadiya/shared';
import { z } from 'zod';

import * as imageService from '../../images/image.service.js';
import type { RegisteredTool } from './tool-registry.js';

/**
 * The assistant's route to an image.
 *
 * One tool, and it is deliberately the only one: the model describes what it
 * wants drawn and everything else — the provider, the size string, the bytes,
 * where they are stored, who may see them — happens below it. The agent never
 * touches an image API, and the tool never touches a filesystem.
 *
 * What the model *does* own is the prompt, and that is the interesting part. A
 * good image prompt is not the user's sentence repeated back: it describes a
 * scene. So the description below asks for one, and asks the model to read the
 * real product first rather than inventing a watch that Hadiya does not sell.
 */

const aspectRatioDescription = IMAGE_ASPECT_RATIOS.map(
  (ratio) => `${ratio} — ${ASPECT_RATIO_GUIDANCE[ratio]}`,
).join(' ');

export const generateImageTool: RegisteredTool = {
  name: 'generate_image',
  category: 'image',
  description: [
    'Generate an image with AI. Use it when the user asks for a picture, a banner, a product shot or a visual for a post — "shu post uchun rasm yarat", "Instagram uchun banner yarat".',
    'Write the prompt as a description of the scene, in English, however the user wrote to you: what is in frame, the setting, the lighting, the mood. Do not simply repeat their sentence.',
    'If they are asking for a picture of something the shop actually sells, call billz_search_products first and describe that product — never invent a price or a label the shop does not have. For a generic picture, draw it directly; do not go looking through the catalogue for something that is not in it.',
    'Pass contentItemId when the image belongs to a specific day of a content plan; use get_content_plan to find the id. Nothing else about the plan is changed.',
    'Each image costs money, so generate one unless the user asked for options.',
  ].join(' '),
  mutates: true,
  schema: z.object({
    prompt: z
      .string()
      .trim()
      .min(IMAGE_PROMPT_MIN_LENGTH)
      .max(IMAGE_PROMPT_MAX_LENGTH)
      .describe('A description of the scene to draw, in English'),
    aspectRatio: z
      .enum(IMAGE_ASPECT_RATIOS)
      .default('1:1')
      .describe(`The shape of the image. ${aspectRatioDescription}`),
    style: z
      .enum(IMAGE_STYLES)
      .optional()
      .describe(
        'The look: photo, lifestyle, studio, illustration, minimal or bold. Leave out if the user did not indicate one.',
      ),
    quality: z
      .enum(IMAGE_QUALITIES)
      .optional()
      .describe('high costs more and takes longer; use it only when asked for'),
    count: z
      .number()
      .int()
      .min(1)
      .max(IMAGE_MAX_COUNT)
      .default(1)
      .describe('How many variations. Only above 1 when the user asked for options.'),
    contentItemId: z
      .string()
      .trim()
      .length(24)
      .optional()
      .describe('The content item this image is for, from get_content_plan'),
  }),
  execute: async (args, context) => {
    const input = args as {
      prompt: string;
      aspectRatio: ImageAspectRatio;
      style?: ImageStyle;
      quality?: ImageQuality;
      count: number;
      contentItemId?: string;
    };

    const result = await imageService.generateImages(context.actor, {
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      ...(input.style ? { style: input.style } : {}),
      ...(input.quality ? { quality: input.quality } : {}),
      count: input.count,
      ...(input.contentItemId ? { contentItemId: input.contentItemId } : {}),
      conversationId: context.conversationId,
      metadata: { source: 'assistant' },
    });

    if (result.images.length === 0) {
      throw new Error('No image was produced');
    }

    return {
      summary: [
        `${result.images.length} image(s) generated at ${input.aspectRatio}${
          input.contentItemId ? ' and attached to the content item' : ''
        }.`,
        result.note ?? '',
        // The model is told the images exist and where they are, so it can say
        // so; it never receives the bytes.
        `They are saved and visible in the gallery: ${result.images
          .map((image) => String(image._id))
          .join(', ')}.`,
      ]
        .filter(Boolean)
        .join(' '),
      // The structured payload is what a chat client renders: URL, prompt,
      // status and content association, with nothing else to fetch.
      data: {
        images: result.images.map((image) => ({
          id: String(image._id),
          url: image.url,
          prompt: image.prompt,
          revisedPrompt: image.revisedPrompt,
          status: image.status,
          aspectRatio: image.aspectRatio,
          width: image.width,
          height: image.height,
          contentItemId: image.contentItem ? String(image.contentItem) : null,
        })),
        note: result.note,
      },
    };
  },
};

export const IMAGE_TOOLS: readonly RegisteredTool[] = [generateImageTool];

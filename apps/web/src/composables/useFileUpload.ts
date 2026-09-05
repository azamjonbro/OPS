import { FILE_LIMITS, type BusinessFile } from '@hadiya/shared';
import { ref, type Ref } from 'vue';

import { toErrorMessage } from '@/services/api-error';
import { fileService } from '@/services/file.service';

/**
 * Attaching documents to a message, without sending anything.
 *
 * The rule this exists to hold is the same one voice input holds: picking a
 * file must never send a message. An upload produces an attachment the person
 * can look at, rename their question around, or remove — and it becomes part of
 * a turn only when they press Send.
 *
 * Each attachment carries its own state, so one failing upload does not take
 * the others down with it and a slow spreadsheet does not block a small CSV
 * that was picked after it.
 */
export type AttachmentState = 'uploading' | 'ready' | 'failed';

export interface Attachment {
  /** Local id, stable from the moment the file is picked. */
  localId: string;
  name: string;
  sizeBytes: number;
  state: AttachmentState;
  /** The server's record, once the upload succeeded. */
  file: BusinessFile | null;
  error: string | null;
}

export interface FileUpload {
  attachments: Readonly<Ref<Attachment[]>>;
  /** True while anything is still uploading, so Send can wait for it. */
  isUploading: Readonly<Ref<boolean>>;
  add: (files: File[]) => Promise<void>;
  remove: (localId: string) => Promise<void>;
  /** Ready attachments only — a failed one is not part of the turn. */
  readyFiles: () => BusinessFile[];
  clear: () => void;
}

let counter = 0;

export const useFileUpload = (): FileUpload => {
  const attachments = ref<Attachment[]>([]);
  const isUploading = ref(false);

  const patch = (localId: string, changes: Partial<Attachment>): void => {
    attachments.value = attachments.value.map((entry) =>
      entry.localId === localId ? { ...entry, ...changes } : entry,
    );
  };

  const add = async (files: File[]): Promise<void> => {
    const accepted = files.filter((file) => {
      // Checked here as well as on the server so an obviously oversized file
      // fails in front of the person instead of after a long upload. The
      // server's check is the one that matters; this one is a courtesy.
      if (file.size > FILE_LIMITS.maxBytes) {
        counter += 1;
        attachments.value = [
          ...attachments.value,
          {
            localId: `f${counter}`,
            name: file.name,
            sizeBytes: file.size,
            state: 'failed',
            file: null,
            error: 'Fayl hajmi ruxsat etilgan limitdan katta.',
          },
        ];

        return false;
      }

      return true;
    });

    const pending = accepted.map((file) => {
      counter += 1;

      const attachment: Attachment = {
        localId: `f${counter}`,
        name: file.name,
        sizeBytes: file.size,
        state: 'uploading',
        file: null,
        error: null,
      };

      return { attachment, file };
    });

    attachments.value = [...attachments.value, ...pending.map((entry) => entry.attachment)];
    isUploading.value = true;

    try {
      await Promise.all(
        pending.map(async ({ attachment, file }) => {
          try {
            const uploaded = await fileService.upload(file);

            patch(attachment.localId, { state: 'ready', file: uploaded, error: null });
          } catch (caught) {
            // The server's sentence is shown as-is: it is already written for a
            // person and says which rule the file broke.
            patch(attachment.localId, {
              state: 'failed',
              error: toErrorMessage(caught, 'Faylni yuklab bo‘lmadi.'),
            });
          }
        }),
      );
    } finally {
      isUploading.value = false;
    }
  };

  /**
   * Takes an attachment off the message, and off the server.
   *
   * A file the person removed before sending was never part of a conversation,
   * so leaving it in their document list would be surprising. A delete that
   * fails is ignored: the attachment is gone from the message either way, and
   * a retention sweep is a better place to worry about an orphan than a
   * composer is.
   */
  const remove = async (localId: string): Promise<void> => {
    const attachment = attachments.value.find((entry) => entry.localId === localId);

    attachments.value = attachments.value.filter((entry) => entry.localId !== localId);

    if (attachment?.file) {
      await fileService.remove(attachment.file.id).catch(() => undefined);
    }
  };

  const readyFiles = (): BusinessFile[] =>
    attachments.value.flatMap((entry) =>
      entry.state === 'ready' && entry.file ? [entry.file] : [],
    );

  const clear = (): void => {
    attachments.value = [];
  };

  return { attachments, isUploading, add, remove, readyFiles, clear };
};

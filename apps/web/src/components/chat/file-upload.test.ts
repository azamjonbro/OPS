import type { BusinessFile } from '@hadiya/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fileService } from '@/services/file.service';
import MessageComposer from './MessageComposer.vue';

/**
 * Attaching documents to a turn.
 *
 * The rule most of these cases exist to hold is the same one dictation holds:
 * picking a file must never send a message. It is the kind of behaviour a later
 * refactor quietly "improves" into an auto-send, so it is asserted from several
 * directions.
 */
const uploaded = (overrides: Partial<BusinessFile> = {}): BusinessFile =>
  ({
    id: 'file-1',
    user: 'u1',
    displayName: 'sales.csv',
    kind: 'csv',
    contentType: 'text/csv',
    sizeBytes: 2_400,
    status: 'ready',
    failureReason: null,
    summary: {
      kind: 'csv',
      pageCount: null,
      textChars: 0,
      sheets: [
        {
          name: 'CSV',
          rowCount: 2_431,
          columns: [
            { name: 'Product', kind: 'text', filled: 2_431, samples: ['Choy'] },
            { name: 'Revenue', kind: 'number', filled: 2_431, samples: ['1200'] },
          ],
        },
      ],
      warnings: [],
      truncated: false,
    },
    createdAt: '2026-09-06T09:00:00Z',
    updatedAt: '2026-09-06T09:00:00Z',
    ...overrides,
  }) as BusinessFile;

const csvFile = (name = 'sales.csv', size = 2_400): File => {
  const file = new File(['Product,Revenue\nChoy,1200\n'], name, { type: 'text/csv' });

  // happy-dom computes size from the parts; the tests need a chosen one.
  Object.defineProperty(file, 'size', { value: size });

  return file;
};

const mountComposer = () =>
  mount(MessageComposer, { attachTo: document.body, global: { plugins: [createPinia()] } });

/** Drives the hidden picker the way a real selection does. */
const pick = async (wrapper: ReturnType<typeof mountComposer>, files: File[]): Promise<void> => {
  const input = wrapper.find('input[type="file"]');

  Object.defineProperty(input.element, 'files', { value: files, configurable: true });
  await input.trigger('change');
  await flushPromises();
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('the attach control', () => {
  it('is offered beside the composer, with a label rather than only an icon', () => {
    const wrapper = mountComposer();
    const button = wrapper.find('button[aria-label="Attach a document"]');

    expect(button.exists()).toBe(true);
  });

  it('accepts only the formats the server can read', () => {
    const accept = mountComposer().find('input[type="file"]').attributes('accept') ?? '';

    expect(accept).toContain('.pdf');
    expect(accept).toContain('.xlsx');
    expect(accept).toContain('.csv');
    expect(accept).toContain('.docx');
    // Offering a format the server refuses is a dialog that wastes an upload.
    expect(accept).not.toContain('.exe');
    expect(accept).not.toContain('.zip');
  });
});

describe('uploading', () => {
  it('uploads as soon as a file is picked and shows it as ready', async () => {
    const upload = vi.spyOn(fileService, 'upload').mockResolvedValue(uploaded());
    const wrapper = mountComposer();

    await pick(wrapper, [csvFile()]);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('sales.csv');
    expect(wrapper.text()).toContain('Tayyor');
  });

  it('shows the shape of the document, never its contents', async () => {
    vi.spyOn(fileService, 'upload').mockResolvedValue(uploaded());
    const wrapper = mountComposer();

    await pick(wrapper, [csvFile()]);

    expect(wrapper.text()).toContain('2431 satr');
    expect(wrapper.text()).toContain('2 ustun');
    // A cell value has no business on a chip.
    expect(wrapper.text()).not.toContain('Choy');
  });

  it('shows the server’s own sentence when a file is refused', async () => {
    vi.spyOn(fileService, 'upload').mockRejectedValue(
      Object.assign(new Error('Bu fayl turi qo‘llab-quvvatlanmaydi.'), {
        name: 'ApiClientError',
      }),
    );
    const wrapper = mountComposer();

    await pick(wrapper, [csvFile()]);

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('qo‘llab-quvvatlanmaydi');
  });

  it('refuses an oversized file in front of the person, without uploading it', async () => {
    const upload = vi.spyOn(fileService, 'upload');
    const wrapper = mountComposer();

    await pick(wrapper, [csvFile('huge.csv', 40 * 1024 * 1024)]);

    expect(upload).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('limitdan katta');
  });

  it('lets one upload fail without taking the others down', async () => {
    vi.spyOn(fileService, 'upload')
      .mockResolvedValueOnce(uploaded({ id: 'a', displayName: 'good.csv' }))
      .mockRejectedValueOnce(new Error('Faylni yuklab bo‘lmadi.'));

    const wrapper = mountComposer();

    await pick(wrapper, [csvFile('good.csv'), csvFile('bad.csv')]);

    expect(wrapper.text()).toContain('good.csv');
    expect(wrapper.text()).toContain('bad.csv');
    expect(wrapper.text()).toContain('Tayyor');
  });

  it('removes an attachment from the message and from the server', async () => {
    vi.spyOn(fileService, 'upload').mockResolvedValue(uploaded());
    const remove = vi.spyOn(fileService, 'remove').mockResolvedValue({ deleted: true });
    const wrapper = mountComposer();

    await pick(wrapper, [csvFile()]);
    await wrapper.find('button[aria-label="Remove sales.csv"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('sales.csv');
    // A file taken off a message before sending was never part of a
    // conversation, so leaving it in the document list would be surprising.
    expect(remove).toHaveBeenCalledWith('file-1');
  });
});

describe('an attachment is a draft, never a message', () => {
  it('does not send when a file finishes uploading', async () => {
    vi.spyOn(fileService, 'upload').mockResolvedValue(uploaded());
    const wrapper = mountComposer();

    await pick(wrapper, [csvFile()]);

    // The line this whole feature is not allowed to cross.
    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('holds Send back while a file is still uploading', async () => {
    let resolve: ((value: BusinessFile) => void) | undefined;

    vi.spyOn(fileService, 'upload').mockReturnValue(
      new Promise((settle) => {
        resolve = settle;
      }),
    );

    const wrapper = mountComposer();
    const input = wrapper.find('input[type="file"]');

    Object.defineProperty(input.element, 'files', { value: [csvFile()], configurable: true });
    await input.trigger('change');
    await flushPromises();

    await wrapper.find('textarea').setValue('Bu faylni analiz qil');
    await flushPromises();

    // Sending a reference to a document the server has not finished reading
    // produces an answer about nothing.
    expect(wrapper.find('button[aria-label="Send message"]').attributes('disabled')).toBeDefined();

    resolve?.(uploaded());
    await flushPromises();

    expect(
      wrapper.find('button[aria-label="Send message"]').attributes('disabled'),
    ).toBeUndefined();
  });

  it('sends the file ids alongside the text, only when the person chooses', async () => {
    vi.spyOn(fileService, 'upload').mockResolvedValue(uploaded());
    const wrapper = mountComposer();

    await pick(wrapper, [csvFile()]);
    await wrapper.find('textarea').setValue('Bu faylni analiz qil');
    await wrapper.find('button[aria-label="Send message"]').trigger('click');

    expect(wrapper.emitted('send')?.[0]).toEqual(['Bu faylni analiz qil', ['file-1']]);
  });

  it('lets an attachment alone be a turn, with no typing', async () => {
    vi.spyOn(fileService, 'upload').mockResolvedValue(uploaded());
    const wrapper = mountComposer();

    await pick(wrapper, [csvFile()]);

    // "Analyse this" with the file attached and nothing typed is an ordinary
    // request, so Send is available.
    expect(
      wrapper.find('button[aria-label="Send message"]').attributes('disabled'),
    ).toBeUndefined();
  });

  it('does not count a failed upload as content', async () => {
    vi.spyOn(fileService, 'upload').mockRejectedValue(new Error('nope'));
    const wrapper = mountComposer();

    await pick(wrapper, [csvFile()]);

    expect(wrapper.find('button[aria-label="Send message"]').attributes('disabled')).toBeDefined();
  });

  it('clears the attachments once the turn has been sent', async () => {
    vi.spyOn(fileService, 'upload').mockResolvedValue(uploaded());
    const wrapper = mountComposer();

    await pick(wrapper, [csvFile()]);
    await wrapper.find('textarea').setValue('analiz qil');
    await wrapper.find('button[aria-label="Send message"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('sales.csv');
  });
});

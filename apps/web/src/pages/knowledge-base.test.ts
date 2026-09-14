import type { BusinessFile } from '@hadiya/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetToasts } from '@/composables/useToast';
import { fileService } from '@/services/file.service';
import { paginated } from '@/test/factories';
import KnowledgeBasePage from './KnowledgeBasePage.vue';

/**
 * The knowledge base, against a mocked API.
 *
 * What matters is the boundary with the chat: this page must only ever ask for
 * documents that have a category, and must only ever upload with one. A page
 * that listed attachments too would show a person every one-off spreadsheet
 * they ever pasted into a conversation; an upload without a category would be
 * an attachment to no conversation, known to nobody.
 */
vi.mock('vue-router', () => ({
  RouterLink: { template: '<a><slot /></a>' },
}));

const aDocument = (overrides: Partial<BusinessFile> = {}): BusinessFile =>
  ({
    id: 'file-1',
    user: 'u1',
    displayName: 'Chegirma siyosati',
    kind: 'pdf',
    contentType: 'application/pdf',
    sizeBytes: 240_000,
    status: 'ready',
    category: 'business',
    failureReason: null,
    summary: {
      kind: 'pdf',
      pageCount: 12,
      textChars: 30_000,
      sheets: [],
      warnings: [],
      truncated: false,
    },
    createdAt: '2026-09-06T09:00:00Z',
    updatedAt: '2026-09-06T09:00:00Z',
    ...overrides,
  }) as BusinessFile;

const pickFile = async (wrapper: ReturnType<typeof mount>, file: File): Promise<void> => {
  const input = wrapper.get('[data-testid="knowledge-file"]').element as HTMLInputElement;

  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await wrapper.get('[data-testid="knowledge-file"]').trigger('change');
};

beforeEach(() => {
  setActivePinia(createPinia());
  resetToasts();
  vi.spyOn(fileService, 'list').mockResolvedValue(
    paginated([
      aDocument(),
      aDocument({ id: 'file-2', displayName: 'Roadmap', category: 'project' }),
    ]),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('KnowledgeBasePage', () => {
  it('asks only for documents in the knowledge base, never for chat attachments', async () => {
    const wrapper = mount(KnowledgeBasePage);
    await flushPromises();

    expect(fileService.list).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeBase: true }),
      expect.any(AbortSignal),
    );

    const list = wrapper.get('[data-testid="knowledge-list"]').text();
    expect(list).toContain('Chegirma siyosati');
    expect(list).toContain('Biznes qoidalari');
    expect(list).toContain('12 sahifa');
    expect(list).toContain('Roadmap');
  });

  it('narrows to one category when a filter is chosen', async () => {
    const wrapper = mount(KnowledgeBasePage);
    await flushPromises();

    const filter = wrapper.findAll('select').at(-1);
    await filter?.setValue('project');
    await flushPromises();

    expect(fileService.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: 'project' }),
      expect.any(AbortSignal),
    );
    expect(vi.mocked(fileService.list).mock.lastCall?.[0]).not.toHaveProperty('knowledgeBase');
  });

  it('uploads with the title and category the person chose', async () => {
    const upload = vi.spyOn(fileService, 'upload').mockResolvedValue(aDocument());
    const wrapper = mount(KnowledgeBasePage);
    await flushPromises();

    const file = new File(['Rule,Value\n'], 'qoidalar_final_v3.csv', { type: 'text/csv' });
    await pickFile(wrapper, file);

    // The filename became a draft title; the person replaces it.
    const title = wrapper.get('input[placeholder="Chegirma siyosati 2026"]');
    expect((title.element as HTMLInputElement).value).toBe('qoidalar_final_v3');
    await title.setValue('Chegirma siyosati');
    await wrapper.findAll('select').at(0)?.setValue('business');

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(upload).toHaveBeenCalledWith(file, { title: 'Chegirma siyosati', category: 'business' });
    // And the shelf was re-read, so the new document is on it.
    expect(fileService.list).toHaveBeenCalledTimes(2);
  });

  it('refuses to submit without a file, without calling the API', async () => {
    const upload = vi.spyOn(fileService, 'upload');
    const wrapper = mount(KnowledgeBasePage);
    await flushPromises();

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(upload).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Avval faylni tanlang.');
  });

  it('shows the server’s sentence when an upload is refused', async () => {
    vi.spyOn(fileService, 'upload').mockRejectedValue(
      new Error('"thing.exe" turidagi fayllar qo‘llab-quvvatlanmaydi.'),
    );
    const wrapper = mount(KnowledgeBasePage);
    await flushPromises();

    await pickFile(wrapper, new File(['x'], 'thing.csv', { type: 'text/csv' }));
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('qo‘llab-quvvatlanmaydi');
  });

  it('asks before removing, then removes and re-reads', async () => {
    const remove = vi.spyOn(fileService, 'remove').mockResolvedValue({ deleted: true });
    const wrapper = mount(KnowledgeBasePage, { attachTo: document.body });
    await flushPromises();

    await wrapper.get('button[aria-label="Chegirma siyosati ni o‘chirish"]').trigger('click');
    await flushPromises();

    expect(remove).not.toHaveBeenCalled();

    const confirm = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'O‘chirish' && button.closest('[role="dialog"]'),
    );
    confirm?.click();
    await flushPromises();

    expect(remove).toHaveBeenCalledWith('file-1');
    expect(fileService.list).toHaveBeenCalledTimes(2);
  });
});

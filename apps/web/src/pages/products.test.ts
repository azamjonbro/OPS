import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { categoryService, productService } from '@/services/catalogue.service';
import { useAuthStore } from '@/stores/auth';
import { makeCategory, makeProduct, makeUser, paginated } from '@/test/factories';
import ProductsPage from './ProductsPage.vue';

/**
 * The product list, exercised through the component rather than the service.
 *
 * What matters is the behaviour a person sees: that a search reaches the API
 * with the right term, that paging asks for the right page, and that a form
 * sends what the API expects. The API itself is mocked, so nothing here needs a
 * server.
 */
/**
 * Attached to the document because the form is a `Teleport` into `document.body`
 * — a detached wrapper renders the page but not its dialogs. The active Pinia is
 * reused rather than a fresh one created, or the signed-in employee set up in
 * `beforeEach` would be discarded and every permission-gated control would
 * vanish.
 */
let pinia: ReturnType<typeof createPinia>;

const mountPage = () =>
  mount(ProductsPage, { attachTo: document.body, global: { plugins: [pinia] } });

/**
 * The dialog is teleported to `document.body`, which is outside the wrapper's
 * DOM subtree, so Test Utils cannot find it — these go through the document.
 * Vue's listeners are real listeners, so a native click drives them fine.
 */
const inDialog = (selector: string): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(`[role='dialog'] ${selector}`),
];

const clickInDialog = async (text: string): Promise<void> => {
  const button = (inDialog('button') as HTMLButtonElement[]).find(
    (candidate) => candidate.textContent?.trim() === text,
  );

  if (!button) {
    throw new Error(`No dialog button labelled "${text}"`);
  }

  button.click();
  await flushPromises();
};

/**
 * Clicks a button by its label, through the wrapper so Vue's own listener runs.
 * Dialog buttons are reached the same way once the dialog is mounted, because
 * the teleport keeps them inside the component tree even though the DOM node
 * sits on `document.body`.
 */
const clickByText = async (wrapper: ReturnType<typeof mountPage>, text: string): Promise<void> => {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().trim() === text);

  if (!button) {
    throw new Error(`No button labelled "${text}"`);
  }

  await button.trigger('click');
  await flushPromises();
};

const typeInto = async (input: HTMLInputElement | undefined, value: string): Promise<void> => {
  if (!input) {
    throw new Error(`No field to type "${value}" into`);
  }

  input.value = value;
  input.dispatchEvent(new Event('input'));
  await flushPromises();
};

afterEach(() => {
  document.body.innerHTML = '';
});

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore();
  auth.user = makeUser({ role: 'manager' });

  vi.spyOn(categoryService, 'list').mockResolvedValue(paginated([makeCategory()]));
});

describe('product list', () => {
  it('renders the products the API returned', async () => {
    vi.spyOn(productService, 'list').mockResolvedValue(
      paginated([makeProduct({ name: 'Cola 1L' }), makeProduct({ name: 'Choy', sku: 'CHOY' })]),
    );

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Cola 1L');
    expect(wrapper.text()).toContain('Choy');
  });

  it('shows the empty state rather than a blank panel', async () => {
    vi.spyOn(productService, 'list').mockResolvedValue(paginated([]));

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('No products match');
  });

  it('shows the error state with a way to retry', async () => {
    const list = vi.spyOn(productService, 'list').mockRejectedValue(new Error('Network error'));

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Network error');

    list.mockResolvedValue(paginated([makeProduct({ name: 'Recovered' })]));
    await wrapper.find('[role="alert"] button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Recovered');
  });
});

describe('product search', () => {
  it('sends the typed term to the API, once it settles', async () => {
    const list = vi.spyOn(productService, 'list').mockResolvedValue(paginated([]));
    vi.useFakeTimers();

    const wrapper = mountPage();
    await flushPromises();
    list.mockClear();

    await wrapper.find('input[type="search"]').setValue('cola');
    // Debounced: nothing is asked for while the person is still typing.
    expect(list).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    await flushPromises();

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'cola', page: 1 }),
      expect.anything(),
    );

    vi.useRealTimers();
  });

  it('returns to the first page when a filter changes', async () => {
    const list = vi
      .spyOn(productService, 'list')
      .mockResolvedValue(paginated([makeProduct()], { total: 60, page: 3 }));

    const wrapper = mountPage();
    await flushPromises();

    // Move to page 3, then narrow the filter.
    const selects = wrapper.findAll('select');
    list.mockClear();
    await selects[1]?.setValue('active');
    await flushPromises();

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, isActive: true }),
      expect.anything(),
    );
  });
});

describe('pagination', () => {
  it('asks for the next page when Next is pressed', async () => {
    const list = vi.spyOn(productService, 'list').mockResolvedValue(
      paginated(
        Array.from({ length: 20 }, (_, index) => makeProduct({ name: `Product ${index}` })),
        { total: 60, pageSize: 20, page: 1 },
      ),
    );

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Showing 1–20 of 60');

    list.mockClear();
    const next = wrapper.findAll('button').find((button) => button.text() === 'Next');
    await next?.trigger('click');
    await flushPromises();

    expect(list).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }), expect.anything());
  });

  it('renders no controls for a single page', async () => {
    vi.spyOn(productService, 'list').mockResolvedValue(paginated([makeProduct()], { total: 1 }));

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('nav[aria-label="Pagination"]').exists()).toBe(false);
  });
});

describe('creating and editing', () => {
  it('sends a new product with the price converted to minor units', async () => {
    vi.spyOn(productService, 'list').mockResolvedValue(paginated([]));
    const create = vi.spyOn(productService, 'create').mockResolvedValue(makeProduct());

    const wrapper = mountPage();
    await flushPromises();

    await clickByText(wrapper, 'New product');

    const fields = inDialog('input') as HTMLInputElement[];
    await typeInto(fields[0], 'New product');
    await typeInto(fields[1], 'NEWSKU');
    await typeInto(
      fields.find((field) => field.getAttribute('type') === 'number'),
      '12.50',
    );

    await clickInDialog('Create product');

    expect(create).toHaveBeenCalledWith(
      // 12.50 becomes 1250 tiyin: the conversion happens once, on submit.
      expect.objectContaining({ name: 'New product', sku: 'NEWSKU', price: 1250 }),
    );
  });

  it('refuses to submit an invalid form, and never reaches the API', async () => {
    vi.spyOn(productService, 'list').mockResolvedValue(paginated([]));
    const create = vi.spyOn(productService, 'create').mockResolvedValue(makeProduct());

    const wrapper = mountPage();
    await flushPromises();

    await clickByText(wrapper, 'New product');
    await clickInDialog('Create product');

    expect(create).not.toHaveBeenCalled();
    // The message is rendered inside the teleported dialog.
    expect(document.body.textContent).toContain('At least 2 characters');
  });

  it('opens the editor with the product already filled in, and keeps the SKU fixed', async () => {
    vi.spyOn(productService, 'list').mockResolvedValue(
      paginated([makeProduct({ name: 'Cola 1L', sku: 'COLA1L', price: 1_200_000 })]),
    );
    vi.spyOn(productService, 'update').mockResolvedValue(makeProduct());

    const wrapper = mountPage();
    await flushPromises();

    await clickByText(wrapper, 'Edit');

    const skuInput = (inDialog('input') as HTMLInputElement[]).find(
      (input) => input.value === 'COLA1L',
    );

    expect(skuInput?.value).toBe('COLA1L');
    // A SKU is immutable once assigned, so the field is disabled rather than
    // silently ignored on save.
    expect(skuInput?.disabled).toBe(true);
  });
});

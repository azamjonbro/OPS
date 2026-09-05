/**
 * What a tool is doing, in words a shopkeeper would use.
 *
 * The backend names tools for the model — `get_sales_summary`,
 * `create_content_plan` — which is right for a model and wrong for a person.
 * This is the translation, and it is the only place it happens.
 *
 * A name with no entry falls back to a readable form of the name itself rather
 * than being hidden. That matters: a tool added to the backend tomorrow should
 * appear as a legible step, not vanish from the transcript because the frontend
 * had not heard of it.
 */
export interface ToolLabel {
  /** Present tense, shown while the step is running. */
  running: string;
  /** Past tense, shown once it finished. */
  done: string;
}

const LABELS: Record<string, ToolLabel> = {
  // Billz is the shop's system of record. The person does not care which of
  // the two it is — they asked about "savdo" — so these say what was looked at,
  // not where it came from.
  billz_get_sales_summary: {
    running: 'Reading the sales figures',
    done: 'Read the sales figures',
  },
  billz_get_sales: { running: 'Reading the receipts', done: 'Read the receipts' },
  billz_get_sale: { running: 'Opening the receipt', done: 'Opened the receipt' },
  billz_get_products: { running: 'Looking up products', done: 'Looked up products' },
  billz_search_products: { running: 'Searching the catalogue', done: 'Searched the catalogue' },
  billz_get_product: { running: 'Looking up the product', done: 'Found the product' },
  billz_get_categories: { running: 'Reading the categories', done: 'Read the categories' },
  billz_get_inventory: { running: 'Checking what is in stock', done: 'Checked the stock' },
  billz_get_inventory_valuation: {
    running: 'Valuing the shelves',
    done: 'Valued the shelves',
  },
  billz_get_customers: { running: 'Reading the customer list', done: 'Read the customer list' },
  billz_search_customers: { running: 'Searching for the customer', done: 'Searched the customers' },
  billz_get_customer_by_phone: {
    running: 'Looking the customer up',
    done: 'Found the customer',
  },
  billz_get_debts: { running: 'Checking who owes what', done: 'Checked the debts' },
  billz_get_payment_breakdown: {
    running: 'Checking how it was paid',
    done: 'Checked the payment methods',
  },
  billz_get_shops: { running: 'Reading the shop list', done: 'Read the shop list' },
  billz_get_payment_types: {
    running: 'Reading the payment methods',
    done: 'Read the payment methods',
  },

  remember_information: { running: 'Saving what you told me', done: 'Remembered' },
  get_memory: { running: 'Recalling what I know', done: 'Checked what I remember' },
  forget_information: { running: 'Forgetting that', done: 'Forgotten' },

  create_reminder: { running: 'Setting the reminder', done: 'Reminder set' },
  list_reminders: { running: 'Checking your reminders', done: 'Checked your reminders' },
  get_reminder: { running: 'Opening the reminder', done: 'Found the reminder' },
  update_reminder: { running: 'Changing the reminder', done: 'Reminder updated' },
  cancel_reminder: { running: 'Cancelling the reminder', done: 'Reminder cancelled' },

  create_content_plan: { running: 'Writing the content plan', done: 'Content plan saved' },
  list_content_plans: { running: 'Checking your content plans', done: 'Checked your plans' },
  get_content_plan: { running: 'Opening the plan', done: 'Opened the plan' },
  update_content_plan: { running: 'Updating the plan', done: 'Plan updated' },
  delete_content_plan: { running: 'Deleting the plan', done: 'Plan deleted' },
  create_content_item: { running: 'Adding a day to the plan', done: 'Day added' },
  update_content_item: { running: 'Editing that day', done: 'Day updated' },
  delete_content_item: { running: 'Removing that day', done: 'Day removed' },
  regenerate_content_item: { running: 'Rewriting that day', done: 'Rewritten' },
  generate_caption: { running: 'Writing the caption', done: 'Caption written' },
  generate_content_ideas: { running: 'Thinking of ideas', done: 'Ideas ready' },

  generate_image: { running: 'Creating the image', done: 'Image created' },
};

/** `get_sales_summary` becomes `Get sales summary`, for an unknown tool. */
const humanise = (name: string): string => {
  const words = name.replace(/_/g, ' ').trim();

  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const toolLabel = (name: string): ToolLabel =>
  LABELS[name] ?? { running: `${humanise(name)}…`, done: humanise(name) };

/** Groups a tool by what it touches, so the card can carry a fitting icon. */
export type ToolFamily = 'data' | 'content' | 'image' | 'reminder' | 'memory' | 'other';

export const toolFamily = (name: string): ToolFamily => {
  if (name.startsWith('generate_image')) {
    return 'image';
  }

  // Everything Billz answers is a read of the shop's own figures.
  if (name.startsWith('billz_')) {
    return 'data';
  }

  if (name.includes('reminder')) {
    return 'reminder';
  }

  if (name.includes('content') || name.includes('caption')) {
    return 'content';
  }

  if (name.includes('memory') || name.includes('remember') || name.includes('forget')) {
    return 'memory';
  }

  if (name.startsWith('get_') || name.startsWith('list_')) {
    return 'data';
  }

  return 'other';
};

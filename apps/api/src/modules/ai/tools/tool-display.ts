import type { ToolCategory, ToolProvenance } from '@hadiya/shared';

/**
 * What a tool is called when a person is watching it run.
 *
 * A model needs `billz_get_sales_summary`. A shopkeeper watching their question
 * being answered needs "Reading the sales figures". Until now that translation
 * lived in the browser, which was fine while the only thing being labelled was
 * a finished transcript of tools the frontend already knew about. Streaming
 * changes that: the events name tools the frontend has never heard of — every
 * MCP tool on somebody's own server — and a bundle shipped last week cannot
 * have a phrase ready for a tool connected this morning.
 *
 * So the label is decided here, next to the tool, and travels with the event.
 * The browser keeps a fallback for a transcript rendered without events, and
 * prefers what the server sent whenever there is one.
 *
 * Nothing in this file is sensitive. A label says what kind of work is
 * happening — never an argument, an endpoint, an id or a credential.
 */

export interface ToolDisplayLabels {
  /** A short noun phrase: "Sales figures". */
  displayName: string;
  /** Present tense, while it runs. */
  runningLabel: string;
  /** Past tense, once it is done. */
  doneLabel: string;
}

/**
 * Hand-written phrases for the tools Hadiya ships with.
 *
 * Only the ones where a derived phrase would read badly. Everything else falls
 * through to the derivation below, which is what any tool added tomorrow gets
 * — a legible step rather than nothing at all.
 */
const LABELS: Record<string, ToolDisplayLabels> = {
  billz_get_sales_summary: {
    displayName: 'Sales figures',
    runningLabel: 'Reading the sales figures',
    doneLabel: 'Read the sales figures',
  },
  billz_get_sales: {
    displayName: 'Receipts',
    runningLabel: 'Reading the receipts',
    doneLabel: 'Read the receipts',
  },
  billz_get_sale: {
    displayName: 'Receipt',
    runningLabel: 'Opening the receipt',
    doneLabel: 'Opened the receipt',
  },
  billz_get_products: {
    displayName: 'Products',
    runningLabel: 'Looking up products',
    doneLabel: 'Looked up products',
  },
  billz_search_products: {
    displayName: 'Catalogue',
    runningLabel: 'Searching the catalogue',
    doneLabel: 'Searched the catalogue',
  },
  billz_get_product: {
    displayName: 'Product',
    runningLabel: 'Looking up the product',
    doneLabel: 'Found the product',
  },
  billz_get_categories: {
    displayName: 'Categories',
    runningLabel: 'Reading the categories',
    doneLabel: 'Read the categories',
  },
  billz_get_inventory: {
    displayName: 'Stock',
    runningLabel: 'Checking what is in stock',
    doneLabel: 'Checked the stock',
  },
  billz_get_inventory_valuation: {
    displayName: 'Stock value',
    runningLabel: 'Valuing the shelves',
    doneLabel: 'Valued the shelves',
  },
  billz_get_customers: {
    displayName: 'Customers',
    runningLabel: 'Reading the customer list',
    doneLabel: 'Read the customer list',
  },
  billz_search_customers: {
    displayName: 'Customer search',
    runningLabel: 'Searching for the customer',
    doneLabel: 'Searched the customers',
  },
  billz_get_customer_by_phone: {
    displayName: 'Customer',
    runningLabel: 'Looking the customer up',
    doneLabel: 'Found the customer',
  },
  billz_get_debts: {
    displayName: 'Debts',
    runningLabel: 'Checking who owes what',
    doneLabel: 'Checked the debts',
  },
  billz_get_payment_breakdown: {
    displayName: 'Payment methods',
    runningLabel: 'Checking how it was paid',
    doneLabel: 'Checked the payment methods',
  },
  billz_get_shops: {
    displayName: 'Shops',
    runningLabel: 'Reading the shop list',
    doneLabel: 'Read the shop list',
  },
  billz_get_payment_types: {
    displayName: 'Payment types',
    runningLabel: 'Reading the payment methods',
    doneLabel: 'Read the payment methods',
  },

  remember_information: {
    displayName: 'Memory',
    runningLabel: 'Saving what you told me',
    doneLabel: 'Remembered',
  },
  get_memory: {
    displayName: 'Memory',
    runningLabel: 'Recalling what I know',
    doneLabel: 'Checked what I remember',
  },
  forget_information: {
    displayName: 'Memory',
    runningLabel: 'Forgetting that',
    doneLabel: 'Forgotten',
  },

  create_reminder: {
    displayName: 'Reminder',
    runningLabel: 'Setting the reminder',
    doneLabel: 'Reminder set',
  },
  list_reminders: {
    displayName: 'Reminders',
    runningLabel: 'Checking your reminders',
    doneLabel: 'Checked your reminders',
  },
  get_reminder: {
    displayName: 'Reminder',
    runningLabel: 'Opening the reminder',
    doneLabel: 'Found the reminder',
  },
  update_reminder: {
    displayName: 'Reminder',
    runningLabel: 'Changing the reminder',
    doneLabel: 'Reminder updated',
  },
  cancel_reminder: {
    displayName: 'Reminder',
    runningLabel: 'Cancelling the reminder',
    doneLabel: 'Reminder cancelled',
  },

  create_content_plan: {
    displayName: 'Content plan',
    runningLabel: 'Writing the content plan',
    doneLabel: 'Content plan saved',
  },
  list_content_plans: {
    displayName: 'Content plans',
    runningLabel: 'Checking your content plans',
    doneLabel: 'Checked your plans',
  },
  get_content_plan: {
    displayName: 'Content plan',
    runningLabel: 'Opening the plan',
    doneLabel: 'Opened the plan',
  },
  update_content_plan: {
    displayName: 'Content plan',
    runningLabel: 'Updating the plan',
    doneLabel: 'Plan updated',
  },
  delete_content_plan: {
    displayName: 'Content plan',
    runningLabel: 'Deleting the plan',
    doneLabel: 'Plan deleted',
  },
  create_content_item: {
    displayName: 'Content',
    runningLabel: 'Adding a day to the plan',
    doneLabel: 'Day added',
  },
  update_content_item: {
    displayName: 'Content',
    runningLabel: 'Editing that day',
    doneLabel: 'Day updated',
  },
  delete_content_item: {
    displayName: 'Content',
    runningLabel: 'Removing that day',
    doneLabel: 'Day removed',
  },
  regenerate_content_item: {
    displayName: 'Content',
    runningLabel: 'Rewriting that day',
    doneLabel: 'Rewritten',
  },
  generate_caption: {
    displayName: 'Caption',
    runningLabel: 'Writing the caption',
    doneLabel: 'Caption written',
  },
  generate_content_ideas: {
    displayName: 'Content ideas',
    runningLabel: 'Thinking of ideas',
    doneLabel: 'Ideas ready',
  },

  generate_image: {
    displayName: 'Image',
    runningLabel: 'Creating the image',
    doneLabel: 'Image created',
  },

  'notion.search': {
    displayName: 'Notion',
    runningLabel: 'Searching Notion',
    doneLabel: 'Searched Notion',
  },
  'notion.read_page': {
    displayName: 'Notion page',
    runningLabel: 'Reading the Notion page',
    doneLabel: 'Read the Notion page',
  },
};

/** `search_customers` becomes `Search customers`. */
const humanise = (value: string): string => {
  const words = value
    .replace(/[_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return words.length === 0 ? 'Step' : words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * A phrase for a tool nobody wrote one for.
 *
 * Chiefly the MCP case: the name comes from somebody else's server and Hadiya
 * has never seen it before. The external name is used rather than the
 * namespaced registry name — `mcp.65f1a.…search_customers` is an internal
 * identifier and putting it on a screen would be leaking a shape nobody needs
 * to see — and the integration's own name says where the work is happening.
 */
const derive = (options: {
  name: string;
  category: ToolCategory;
  provenance: ToolProvenance;
}): ToolDisplayLabels => {
  const external = options.provenance.externalName ?? options.name;
  const readable = humanise(external);
  const service = options.provenance.integrationName;

  if (service) {
    return {
      displayName: `${service}: ${readable}`,
      runningLabel: `${readable} — ${service}`,
      doneLabel: `${readable} — ${service}`,
    };
  }

  return { displayName: readable, runningLabel: readable, doneLabel: readable };
};

export const toolDisplayFor = (options: {
  name: string;
  category: ToolCategory;
  provenance: ToolProvenance;
  /** What the tool itself declared, which always wins. */
  declared?: Partial<ToolDisplayLabels> | undefined;
}): ToolDisplayLabels => {
  const base = LABELS[options.name] ?? derive(options);

  return {
    displayName: options.declared?.displayName ?? base.displayName,
    runningLabel: options.declared?.runningLabel ?? base.runningLabel,
    doneLabel: options.declared?.doneLabel ?? base.doneLabel,
  };
};

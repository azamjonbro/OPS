import { config } from '../../../config/index.js';
import { createLogger } from '../../../core/logger/logger.js';
import { McpError } from '../mcp/mcp-error.js';
import { sanitiseExternalText } from '../mcp/mcp-tool-schema.js';

const log = createLogger('amocrm');

/**
 * A small, deliberately narrow amoCRM client.
 *
 * Reads only, and few of them: who the account is, the pipelines and their
 * stages, leads (deals) by text or by stage, one lead in full, contacts by
 * text. amoCRM's API can also create, move and delete all of these; none of
 * that is here, because Hadiya's job with the CRM is to answer "where does the
 * deal with Karimov stand" and "how many are stuck in negotiation" — not to
 * move them. Widening it is a decision someone should make on purpose.
 *
 * The credential is a **long-lived token** the person generates in amoCRM's
 * own settings. It is a bearer like any other; the reason it is worth naming
 * is what it is *not*: an OAuth flow with a refresh dance that expires the
 * moment a server restarts at the wrong time. The person pastes it once and
 * revokes it in amoCRM when they want it gone.
 *
 * `McpError` is reused as the failure vocabulary, for the same reason the
 * Notion client reuses it.
 */

/** Hosts amoCRM sells the same product under. Nothing else is ever contacted. */
export const AMOCRM_DOMAINS = ['amocrm.ru', 'kommo.com'] as const;

export type AmocrmDomain = (typeof AMOCRM_DOMAINS)[number];

/**
 * Where an account lives: `https://{subdomain}.{domain}`.
 *
 * The subdomain is the only thing a person types, and it is held to letters,
 * digits and hyphens, so a request can never be steered anywhere but under an
 * amoCRM domain — a client that accepted a full URL would be a way to make the
 * server fetch an address of the caller's choosing with a bearer attached.
 */
export interface AmocrmAccountLocation {
  subdomain: string;
  domain: AmocrmDomain;
}

export interface AmocrmIdentity {
  id: number | null;
  name: string;
  subdomain: string;
}

export interface AmocrmStage {
  id: number;
  name: string;
  /** 142 is "won" and 143 is "lost" in every amoCRM account. */
  kind: 'open' | 'won' | 'lost';
}

export interface AmocrmPipeline {
  id: number;
  name: string;
  isMain: boolean;
  stages: AmocrmStage[];
}

export interface AmocrmLeadSummary {
  id: number;
  name: string;
  /** In the account's currency, whole units as amoCRM keeps them. */
  price: number;
  pipelineId: number | null;
  statusId: number | null;
  responsibleUserId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  /** Names of the contacts linked to the lead, when the API embedded them. */
  contactNames: string[];
}

export interface AmocrmContact {
  id: number;
  name: string;
  phones: string[];
  emails: string[];
  responsibleUserId: number | null;
  updatedAt: string | null;
}

export interface AmocrmNote {
  createdAt: string | null;
  text: string;
}

const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{1,62}$/;

export const isValidAmocrmSubdomain = (value: string): boolean => SUBDOMAIN.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** amoCRM keeps every timestamp as Unix seconds. */
const asIso = (value: unknown): string | null => {
  const seconds = asNumber(value);

  return seconds === null || seconds <= 0 ? null : new Date(seconds * 1_000).toISOString();
};

const asText = (value: unknown, limit: number): string =>
  typeof value === 'string' ? sanitiseExternalText(value, limit) : '';

const embedded = (body: unknown, key: string): Record<string, unknown>[] => {
  const container = isRecord(body) && isRecord(body._embedded) ? body._embedded : {};
  const list = container[key];

  return Array.isArray(list) ? list.filter(isRecord) : [];
};

/**
 * One request to amoCRM, with a deadline and a normalised failure.
 *
 * The token goes into the header and nowhere else. What is logged is the path
 * and the status, which is what somebody debugging this needs and nothing that
 * would let them impersonate the account.
 *
 * One quirk is worth knowing: amoCRM answers an empty search with **204 and no
 * body** rather than an empty list. That is returned as `null` here so callers
 * can treat it as "nothing", instead of every caller discovering that
 * `response.json()` throws on it.
 */
const request = async (
  location: AmocrmAccountLocation,
  token: string,
  path: string,
  query: Record<string, string | number | undefined> = {},
): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.integrations.amocrm.timeoutMs);
  const url = new URL(`https://${location.subdomain}.${location.domain}/api/v4${path}`);

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: controller.signal,
    });

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      log.warn({ path, status: response.status }, 'amoCRM request failed');

      if (response.status === 401 || response.status === 403) {
        throw new McpError(
          'authentication',
          'amoCRM refused the saved token. Generate a new long-lived token in amoCRM and paste it here.',
        );
      }

      if (response.status === 429) {
        throw new McpError('rate_limited', 'amoCRM is rate limiting this account.');
      }

      if (response.status === 404) {
        throw new McpError('unreachable', 'amoCRM has no such account or record.');
      }

      // The body may quote the request, so it is never read into a message.
      throw new McpError('unreachable', 'amoCRM returned an error.');
    }

    return await response.json();
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new McpError('timeout', 'amoCRM took too long to answer.');
    }

    log.warn({ path, err: error }, 'amoCRM request failed');

    throw new McpError('unreachable', 'amoCRM could not be reached.');
  } finally {
    clearTimeout(timer);
  }
};

/** Who the stored token belongs to. The health check, and nothing more. */
export const getAmocrmIdentity = async (
  location: AmocrmAccountLocation,
  token: string,
): Promise<AmocrmIdentity> => {
  const body = await request(location, token, '/account');
  const record = isRecord(body) ? body : {};

  return {
    id: asNumber(record.id),
    name: asText(record.name, 80) || 'amoCRM',
    subdomain: asText(record.subdomain, 63) || location.subdomain,
  };
};

const stageKind = (id: number): AmocrmStage['kind'] =>
  id === 142 ? 'won' : id === 143 ? 'lost' : 'open';

/** Every pipeline with its stages, so a status id can be given a name. */
export const listAmocrmPipelines = async (
  location: AmocrmAccountLocation,
  token: string,
): Promise<AmocrmPipeline[]> => {
  const body = await request(location, token, '/leads/pipelines');

  return embedded(body, 'pipelines').flatMap((pipeline) => {
    const id = asNumber(pipeline.id);

    if (id === null) {
      return [];
    }

    const stages = embedded(pipeline, 'statuses').flatMap((status) => {
      const statusId = asNumber(status.id);

      return statusId === null
        ? []
        : [
            {
              id: statusId,
              name: asText(status.name, 80) || `Stage ${statusId}`,
              kind: stageKind(statusId),
            },
          ];
    });

    return [
      {
        id,
        name: asText(pipeline.name, 80) || `Pipeline ${id}`,
        isMain: pipeline.is_main === true,
        stages,
      },
    ];
  });
};

const mapLead = (record: Record<string, unknown>): AmocrmLeadSummary | null => {
  const id = asNumber(record.id);

  if (id === null) {
    return null;
  }

  const contactNames = embedded(record, 'contacts')
    .map((contact) => asText(contact.name, 120))
    .filter((name) => name.length > 0);

  return {
    id,
    name: asText(record.name, 200) || `Lead ${id}`,
    price: asNumber(record.price) ?? 0,
    pipelineId: asNumber(record.pipeline_id),
    statusId: asNumber(record.status_id),
    responsibleUserId: asNumber(record.responsible_user_id),
    createdAt: asIso(record.created_at),
    updatedAt: asIso(record.updated_at),
    closedAt: asIso(record.closed_at),
    contactNames,
  };
};

export interface AmocrmLeadQuery {
  /** Free text, matched by amoCRM against names, contacts and custom fields. */
  query?: string | undefined;
  pipelineId?: number | undefined;
  statusId?: number | undefined;
  /** Unix seconds; amoCRM filters on creation time inclusively. */
  createdFrom?: number | undefined;
  createdTo?: number | undefined;
  limit: number;
}

/**
 * Leads, by text or by stage.
 *
 * One page only, bounded at amoCRM's own maximum of 250. The API offers no
 * count, so "how many" is answered by fetching them; the bound is what keeps
 * that from becoming an account-wide crawl on a busy CRM.
 */
export const searchAmocrmLeads = async (
  location: AmocrmAccountLocation,
  token: string,
  params: AmocrmLeadQuery,
): Promise<AmocrmLeadSummary[]> => {
  const body = await request(location, token, '/leads', {
    query: params.query,
    limit: Math.min(Math.max(params.limit, 1), 250),
    with: 'contacts',
    'filter[pipeline_id]': params.pipelineId,
    'filter[statuses][0][pipeline_id]':
      params.statusId === undefined ? undefined : params.pipelineId,
    'filter[statuses][0][status_id]': params.statusId,
    'filter[created_at][from]': params.createdFrom,
    'filter[created_at][to]': params.createdTo,
    order: 'updated_at',
  });

  return embedded(body, 'leads').flatMap((record) => {
    const lead = mapLead(record);

    return lead ? [lead] : [];
  });
};

/**
 * One lead with its contacts and the last few notes.
 *
 * Notes are where the conversation with the customer actually lives — the
 * "called, will decide Monday" a person wants quoted back — so they are read
 * alongside the lead rather than as a separate tool the model has to think to
 * call. Bounded, because a long-running deal can carry hundreds.
 */
export const readAmocrmLead = async (
  location: AmocrmAccountLocation,
  token: string,
  leadId: number,
): Promise<{ lead: AmocrmLeadSummary; notes: AmocrmNote[] } | null> => {
  const body = await request(location, token, `/leads/${leadId}`, { with: 'contacts' });

  if (!isRecord(body)) {
    return null;
  }

  const lead = mapLead(body);

  if (!lead) {
    return null;
  }

  const notesBody = await request(location, token, `/leads/${leadId}/notes`, {
    limit: 10,
    order: 'updated_at',
  });

  const notes = embedded(notesBody, 'notes').flatMap((note) => {
    const params = isRecord(note.params) ? note.params : {};
    const text = asText(params.text, 1_000) || asText(params.service, 200);

    return text ? [{ createdAt: asIso(note.created_at), text }] : [];
  });

  return { lead, notes };
};

/**
 * Digs phones and emails out of amoCRM's custom-field shape.
 *
 * Contact details are not fields on the contact; they are entries in
 * `custom_fields_values` whose `field_code` says which they are. This walks
 * that structure once so nothing else has to know it.
 */
const readContactChannels = (
  record: Record<string, unknown>,
): { phones: string[]; emails: string[] } => {
  const phones: string[] = [];
  const emails: string[] = [];
  const fields = Array.isArray(record.custom_fields_values) ? record.custom_fields_values : [];

  for (const field of fields) {
    if (!isRecord(field) || !Array.isArray(field.values)) {
      continue;
    }

    const values = field.values
      .map((entry) => (isRecord(entry) ? asText(entry.value, 120) : ''))
      .filter((value) => value.length > 0);

    if (field.field_code === 'PHONE') {
      phones.push(...values);
    } else if (field.field_code === 'EMAIL') {
      emails.push(...values);
    }
  }

  return { phones, emails };
};

export const searchAmocrmContacts = async (
  location: AmocrmAccountLocation,
  token: string,
  params: { query: string; limit: number },
): Promise<AmocrmContact[]> => {
  const body = await request(location, token, '/contacts', {
    query: params.query,
    limit: Math.min(Math.max(params.limit, 1), 50),
  });

  return embedded(body, 'contacts').flatMap((record) => {
    const id = asNumber(record.id);

    if (id === null) {
      return [];
    }

    return [
      {
        id,
        name: asText(record.name, 120) || `Contact ${id}`,
        ...readContactChannels(record),
        responsibleUserId: asNumber(record.responsible_user_id),
        updatedAt: asIso(record.updated_at),
      },
    ];
  });
};

import type { AuthenticatedUser } from '@hadiya/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { actorFor, createTestBranch, createTestUser, signInAs } from '../../test/factories.js';
import type { IntegrationDocument } from './integration.model.js';
import { createIntegration } from './integration.service.js';
import { icloudMailProvider } from './providers/index.js';

/**
 * iCloud Mail as a native integration.
 *
 * Nothing here opens a socket. What is worth pinning is the part that runs
 * before one is opened — which credentials are accepted, what is stored, and
 * what a client is allowed to see — because that is where a mistake would put
 * an app-specific password somewhere it should never be. Whether Apple accepts
 * a real password is Apple's answer to give, and no test can stand in for it.
 */
const app = createApp();
const url = '/api/v1/integrations';
const APP_PASSWORD = 'abcd-efgh-ijkl-mnop';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

const anActor = async (): Promise<AuthenticatedUser> => {
  const branch = await createTestBranch();
  const user = await createTestUser('manager', String(branch._id));

  return actorFor(user);
};

describe('connecting iCloud Mail', () => {
  it('is offered by the catalogue as a native provider needing a credential', async () => {
    const { authorization } = await signInAs(app, 'manager', null);

    const response = await request(app).get(`${url}/catalogue`).set('Authorization', authorization);

    const icloud = response.body.data.items.find(
      (item: { provider: string }) => item.provider === 'icloud_mail',
    );

    expect(icloud).toMatchObject({
      type: 'native',
      label: 'iCloud Mail',
      requiresCredential: true,
      requiresServerUrl: false,
    });
  });

  it('refuses a connection with no Apple ID address', async () => {
    const actor = await anActor();

    await expect(
      createIntegration(actor, {
        provider: 'icloud_mail',
        name: 'My mail',
        secret: APP_PASSWORD,
      }),
    ).rejects.toThrow(/Apple ID email/i);
  });

  it('refuses the Apple ID password in place of an app-specific one', async () => {
    const actor = await anActor();

    await expect(
      createIntegration(actor, {
        provider: 'icloud_mail',
        name: 'My mail',
        secret: 'my-real-apple-password',
        options: { email: 'shop@icloud.com' },
      }),
    ).rejects.toThrow(/four groups of four letters/i);
  });

  it('stores the address in the open and the password only encrypted', async () => {
    const { authorization } = await signInAs(app, 'manager', null);

    const created = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({
        provider: 'icloud_mail',
        name: 'Shop mail',
        secret: APP_PASSWORD,
        options: { email: 'Shop@iCloud.com' },
      });

    expect(created.status).toBe(HTTP_STATUS.CREATED);
    // The address is not a secret and a person has to recognise the mailbox.
    expect(created.body.data.config.options).toMatchObject({ email: 'shop@icloud.com' });
    expect(created.body.data.hasCredentials).toBe(true);

    // The password must not appear anywhere in what a browser receives.
    const detail = await request(app)
      .get(`${url}/${String(created.body.data.id)}`)
      .set('Authorization', authorization);

    expect(JSON.stringify(detail.body)).not.toContain(APP_PASSWORD);
  });

  it('reports a switched-off mailbox without reaching Apple', async () => {
    const actor = await anActor();
    const created = await createIntegration(actor, {
      provider: 'icloud_mail',
      name: 'Shop mail',
      secret: APP_PASSWORD,
      options: { email: 'shop@icloud.com' },
    });

    const health = await icloudMailProvider.checkHealth(actor, {
      ...created,
      enabled: false,
    } as IntegrationDocument);

    expect(health).toMatchObject({ status: 'disabled', healthy: false });
  });
});

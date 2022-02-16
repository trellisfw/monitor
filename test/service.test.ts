/**
 * @license
 *  Copyright 2021 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import test from 'ava';

import ksuid from 'ksuid';
import tiny from 'tiny-json-http';

import { OADAClient, connect } from '@oada/client';

import setup from './setup.js';

import config from '../dist/config.js';

const { domain, token } = config.get('oada');
const incomingToken = config.get('server.token');

const { string: oldKSUID } = ksuid.randomSync(new Date('2021-02-03T01:00:00Z'));

setup({ oldKSUID });

const tree = {
  bookmarks: {
    _type: 'application/vnd.oada.bookmarks.1+json',
    trellisfw: {
      '_type': 'application/vnd.trellisfw.1+json',
      'asns': {
        _type: 'application/vnd.trellisfw.asns.1+json',
      },
      'asn-staging': {
        _type: 'application/vnd.trellisfw.asn-staging.1+json',
      },
    },
    services: {
      _type: 'application/vnd.oada.services.1+json',
      target: {
        _type: 'application/vnd.oada.service.1+json',
        jobs: {
          _type: 'application/vnd.oada.service.jobs.1+json',
        },
      },
    },
  },
};

// In watch mode, these tests need to wait for service to restart.  package.json adds `--delay` to
// mocha in this case: it will wait to run our tests until we call "run".  Code for that is at bottom.

let conn: OADAClient;
test.before(async (t) => {
  conn = await connect({ domain, token, connection: 'http' });

  // Setup the trees that it is expecting to be there
  await Promise.all([
    ensurePath('/bookmarks/trellisfw/asn-staging', conn),
    ensurePath('/bookmarks/trellisfw/asns', conn),
    ensurePath('/bookmarks/services/target/jobs', conn),
  ]);

  async function ensurePath(path: string, oada: OADAClient) {
    try {
      await oada.head({ path });
    } catch (error: unknown) {
      // @ts-expect-error errors are annoying
      if (error.status === 404) {
        t.log(`ensurePath: path ${path} did not exist before test, creating`);
        await oada.put({ path, tree, data: {} });
        return;
      }

      t.log(
        `ERROR: ensurePath: HEAD to path ${path} returned non-404 error status:`,
        error
      );
    }
  }
});

test('should fail on check after posting stale asn-staging ksuid key', async (t) => {
  const path = `/bookmarks/trellisfw/asn-staging`;
  await conn.put({
    path,
    data: { [oldKSUID]: { istest: true } },
    contentType: 'application/json',
  });
  const url = `http://localhost:${config.get('server.port')}/trigger`;
  t.log('Getting trigger at url ', url);

  let status: unknown = '';
  try {
    const response = await tiny.get({
      url,
      headers: { authorization: `Bearer ${incomingToken}` },
    });
    status = response?.body?.tests?.staging_clean?.status;
    t.log('Done w/ trigger, checking body: ', response.body);
    t.is(status, 'failure');
  } catch (error: unknown) {
    // @ts-expect-error errors are annoying
    if (!['ECONNREFUSED', 'ENETUNREACH'].includes(error.code)) {
      // Service is running, but something went wrong
      throw error as Error;
    }

    t.log('Service does not appear to be running, skipping this test');
    t.is.skip(status, 'failure');
    return;
  } finally {
    // Cleanup the stale ksuid before testing:
    await conn.delete({ path: `${path}/${oldKSUID}` });
  }

  t.pass();
});

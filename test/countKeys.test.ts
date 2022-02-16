/**
 * @license
 *  Copyright 2022 Qlever LLC
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

import { setupTests } from 'ava-nock';
import test from 'ava';

import { OADAClient, connect } from '@oada/client';
import ksuid from 'ksuid';
import moment from 'moment';

import config from '../dist/config.js';
import { countKeys } from '../dist/testers.js';

const domain = config.get('oada.domain');
const token = config.get('oada.token');

setupTests(test);

let oada: OADAClient;

const parentID = `resources/TRELLIS-MONITOR-TEST-${ksuid.randomSync().string}`;
const indexID = `resources/TRELLIS-MONITOR-TEST-${ksuid.randomSync().string}`;

test.before(async () => {
  oada = await connect({ domain, token, connection: 'http' });
  await oada.put({
    path: `/${indexID}`,
    data: { key1: 'val1', key2: 'val2' },
    contentType: 'application/json',
  });
  await oada.put({
    path: `/${parentID}`,
    data: {
      'day-index': {
        [moment().format('YYYY-MM-DD')]: { _id: indexID, _rev: 0 },
      },
    },
    contentType: 'application/json',
  });
});
test.after(async () => {
  await oada?.delete({ path: `/${parentID}` });
  await oada?.delete({ path: `/${indexID}` });
  await oada?.disconnect();
});

test('should have status: success and count=2 for resource w/ 2 keys', async (t) => {
  const result = await countKeys({
    path: `/${parentID}`,
    index: 'day-index',
    oada,
  });
  t.is(result.status, 'success');
  t.is(result.count, 2);
});

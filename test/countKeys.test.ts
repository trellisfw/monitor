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

import test from 'ava';

import type { OADAClient } from '@oada/client';
import { connect } from '@oada/client';
import ksuid from 'ksuid';
import moment from 'moment';

import setup from './setup.js';

import config from '../dist/config.js';
import { countKeys } from '../dist/testers.js';

const { domain, token } = config.get('oada');

let oada: OADAClient;

const { string: parentID } = ksuid.randomSync();
const { string: indexID } = ksuid.randomSync();
const parentResource = `resources/TRELLIS-MONITOR-TEST-${parentID}`;
const indexResource = `resources/TRELLIS-MONITOR-TEST-${indexID}`;

const today = moment().format('YYYY-MM-DD');

setup({
  parentID,
  indexID,
  today,
});

test.before(async () => {
  oada = await connect({ domain, token, connection: 'http' });
  await oada.put({
    path: `/${indexResource}`,
    data: { key1: 'val1', key2: 'val2' },
    contentType: 'application/json',
  });
  await oada.put({
    path: `/${parentResource}`,
    data: {
      'day-index': {
        [today]: { _id: indexResource, _rev: 0 },
      },
    },
    contentType: 'application/json',
  });
});
test.after(async () => {
  await oada?.delete({ path: `/${parentResource}` });
  await oada?.delete({ path: `/${indexResource}` });
  await oada?.disconnect();
});

test('should have status: success and count=2 for resource w/ 2 keys', async (t) => {
  const result = await countKeys({
    path: `/${parentResource}`,
    index: 'day-index',
    oada,
  });
  t.is(result.status, 'success');
  t.is(result.count, 2);
});

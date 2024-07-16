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

import config from '../dist/config.js';

import test from 'ava';

import ksuid from 'ksuid';
import { setTimeout } from 'isomorphic-timers-promises';

import type { OADAClient } from '@oada/client';
import { connect } from '@oada/client';

import setup from './setup.js';

import { staleKsuidKeys } from '../dist/testers.js';

const { domain, token } = config.get('oada');

const { string: id1 } = ksuid.randomSync();
const { string: id2 } = ksuid.randomSync();
const { string: oldKSUID } = ksuid.randomSync(new Date('2021-02-03T01:00:00Z'));
const { string: newKSUID } = ksuid.randomSync();

setup({
  id1,
  id2,
  oldKSUID,
  newKSUID,
});

let oada: OADAClient;

test.before(async () => {
  oada = await connect({ domain, token, connection: 'http' });
});
test.after(async () => {
  await oada?.disconnect();
});

test('should have status: success for resource w/ recent ksuid key', async (t) => {
  const path = `/resources/TRELLIS-MONITOR-TEST-${id1}`;
  try {
    await oada.put({ path, data: {}, contentType: 'application/json' });

    await setTimeout(1001); // Wait 1 s should be sufficient to test age

    await oada.put({
      path,
      data: { [newKSUID]: true },
      contentType: 'application/json',
    });
    const result = await staleKsuidKeys({ path, maxage: 60, oada });
    await oada.delete({ path: `${path}/${newKSUID}` });
    t.deepEqual(result, { status: 'success' });
  } finally {
    await oada?.delete({ path });
  }
});

test('should have status: failure for resource w/ old ksuid key', async (t) => {
  const path = `/resources/TRELLIS-MONITOR-TEST-${id2}`;
  try {
    await oada.put({ path, data: {}, contentType: 'application/json' });

    await oada.put({
      path,
      data: { [oldKSUID]: true },
      contentType: 'application/json',
    });
    const result = await staleKsuidKeys({ path, maxage: 1, oada });
    await oada.delete({ path: `${path}/${oldKSUID}` });
    t.is(result.status, 'failure');
  } finally {
    await oada?.delete({ path });
  }
});

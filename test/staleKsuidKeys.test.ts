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

import { setTimeout } from 'isomorphic-timers-promises';

import test from 'ava';

import { OADAClient, connect } from '@oada/client';
import ksuid from 'ksuid';

import config from '../dist/config.js';
import { staleKsuidKeys } from '../dist/testers.js';

const domain = config.get('oada.domain');
const token = config.get('oada.token');

let oada: OADAClient;

test.before(async () => {
  oada = await connect({ domain, token, connection: 'http' });
});

test.after(async () => {
  await oada?.disconnect();
});

test('should have status: success for resource w/ recent ksuid key', async (t) => {
  const path = `/resources/TRELLIS-MONITOR-TEST-${ksuid.randomSync().string}`;
  try {
    await oada.put({ path, data: {}, contentType: 'application/json' });

    await setTimeout(1001); // Wait 1 s should be sufficient to test age

    const { string: newKSUID } = await ksuid.random();
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
  const path = `/resources/TRELLIS-MONITOR-TEST-${ksuid.randomSync().string}`;
  try {
    oada = await connect({ domain, token, connection: 'http' });
    await oada.put({ path, data: {}, contentType: 'application/json' });
    const { string: oldKSUID } = await ksuid.random(
      new Date('2021-02-03T01:00:00Z')
    );

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

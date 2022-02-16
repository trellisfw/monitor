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

import { setupTests } from 'ava-nock';
import test from 'ava';

import { OADAClient, connect } from '@oada/client';
import ksuid from 'ksuid';

import config from '../dist/config.js';
import { maxAge } from '../dist/testers.js';

const domain = config.get('oada.domain');
const token = config.get('oada.token');

setupTests(test);

let oada: OADAClient;

const path = `/resources/TRELLIS-MONITOR-TEST-${ksuid.randomSync().string}`;
const delay = 1001;

test.before(async () => {
  oada = await connect({ domain, token, connection: 'http' });
  await oada.put({ path, data: {}, contentType: 'application/json' });
  await setTimeout(delay); // Wait 1 s should be sufficient to test age
});

test.after(async () => {
  await oada?.delete({ path });
  await oada.disconnect();
});

test('should have status: success for recently-created resource', async (t) => {
  const result = await maxAge({ path, maxage: 2 * delay, oada });
  t.is(result.status, 'success');
});

test('should have status: failure for old resource with short maxage', async (t) => {
  const result = await maxAge({ path, maxage: 0.5 * delay, oada });
  t.is(result.status, 'failure');
});

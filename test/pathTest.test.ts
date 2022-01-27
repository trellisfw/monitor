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

import { OADAClient, connect } from '@oada/client';

import config from '../dist/config.js';
import { pathTest } from '../dist/testers.js';

const domain = config.get('oada.domain');
const token = config.get('oada.token');

let oada: OADAClient;

test.before(async () => {
  oada = await connect({ domain, token, connection: 'http' });
});

test.after(async () => oada?.disconnect());

test('should have status: success for well-known', async (t) => {
  const result = await pathTest({
    path: '/.well-known/oada-configuration',
    oada,
  });
  t.deepEqual(result, { status: 'success' });
});

test('should have status: success for bookmarks', async (t) => {
  const result = await pathTest({ path: '/bookmarks', oada });
  t.is(result.status, 'success');
});

test('should have status: failure for nonexistent resource', async (t) => {
  const result = await pathTest({
    path: '/resources/idonotexist57993',
    oada,
  });
  t.is(result.status, 'failure');
});

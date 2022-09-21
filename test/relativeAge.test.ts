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

import type { OADAClient } from '@oada/client';
import { connect } from '@oada/client';
import ksuid from 'ksuid';

import setup from './setup.js';

import config from '../dist/config.js';
import { relativeAge } from '../dist/testers.js';

const { domain, token } = config.get('oada');

const { string: leaderID } = ksuid.randomSync();
const { string: fastID } = ksuid.randomSync();
const { string: slowID } = ksuid.randomSync();

setup({
  leaderID,
  fastID,
  slowID,
});

let oada: OADAClient;

const leader = `/resources/TRELLIS-MONITOR-TEST-${leaderID}`;
const delay = 1000;
const fastFollower = `/resources/TRELLIS-MONITOR-TEST-${fastID}`;
const slowFollower = `/resources/TRELLIS-MONITOR-TEST-${slowID}`;

test.before(async () => {
  oada = await connect({ domain, token, connection: 'http' });

  // "slow_follower" should be stale, i.e. must be BEFORE leader writes
  await oada.put({
    path: slowFollower,
    data: {},
    contentType: 'application/json',
  });
  await oada.put({
    path: leader,
    data: {},
    contentType: 'application/json',
  });
  await oada.put({
    path: fastFollower,
    data: {},
    contentType: 'application/json',
  });
  await setTimeout(delay); // Wait 1 s to start tests so now() is at least 1 sec
});

test.after(async () => {
  await oada.delete({ path: leader });
  await oada.delete({ path: slowFollower });
  await oada.delete({ path: fastFollower });
  await oada?.disconnect();
});

test('should have status: success for fast follower updated after leader', async (t) => {
  const result = await relativeAge({
    leader,
    follower: fastFollower,
    maxage: delay,
    oada,
  });
  t.is(result.status, 'success');
});

test('should have status: failure for slow follower not updated since maxage of leader update', async (t) => {
  const result = await relativeAge({
    leader,
    follower: slowFollower,
    maxage: delay,
    oada,
  });
  t.is(result.status, 'failure');
});

test('should have status: success for slow follower less than maxage BEFORE leader', async (t) => {
  const result = await relativeAge({
    leader,
    follower: slowFollower,
    maxage: 5 * delay,
    oada,
  });
  t.is(result.status, 'success');
});

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

import { setTimeout } from 'node:timers/promises';

import test from 'ava';

import { OADAClient, connect } from '@oada/client';
import { expect } from 'chai';
import ksuid from 'ksuid';
import moment from 'moment';

import {
  countKeys,
  maxAge,
  pathTest,
  relativeAge,
  staleKsuidKeys,
} from '../dist/testers.js';
import config from '../dist/config.js';

const domain = config.get('oada.domain');
const token = config.get('oada.token');

let oada: OADAClient;

test.before(async () => {
  oada = await connect({ domain, token, connection: 'http' });
});

test.after(async () => oada?.disconnect());

//describe('#pathTest', () => {
test('should have status: success for well-known', async () => {
  const result = await pathTest({
    path: '/.well-known/oada-configuration',
    oada,
  });
  expect(result).to.deep.equal({ status: 'success' });
});

test('should have status: success for bookmarks', async () => {
  const result = await pathTest({ path: '/bookmarks', oada });
  expect(result.status).to.equal('success');
});

test('should have status: failure for nonexistent resource', async () => {
  const result = await pathTest({
    path: '/resources/idonotexist57993',
    oada,
  });
  expect(result.status).to.equal('failure');
});
//});

//describe('#relativeAge', () => {
const leader = `/resources/TRELLIS-MONITOR-TEST-${ksuid.randomSync().string}`;
let delay = 1000;
const fastFollower = `/resources/TRELLIS-MONITOR-TEST-${
  ksuid.randomSync().string
}`;
const slowFollower = `/resources/TRELLIS-MONITOR-TEST-${
  ksuid.randomSync().string
}`;

test.before(async () => {
  // "slow_follower" should be stale, i.e. must be BEFORE leader writes
  await oada.put({
    path: slowFollower,
    data: {},
    // eslint-disable-next-line sonarjs/no-duplicate-string
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
});

test('should have status: success for fast follower updated after leader', async () => {
  const result = await relativeAge({
    leader,
    follower: fastFollower,
    maxage: delay,
    oada,
  });
  expect(result.status).to.equal('success');
});

test('should have status: failure for slow follower not updated since maxage of leader update', async () => {
  const result = await relativeAge({
    leader,
    follower: slowFollower,
    maxage: delay,
    oada,
  });
  expect(result.status).to.equal('failure');
});

test('should have status: success for slow follower less than maxage BEFORE leader', async () => {
  const result = await relativeAge({
    leader,
    follower: slowFollower,
    maxage: 5 * delay,
    oada,
  });
  expect(result.status).to.equal('success');
});
//});

//describe('#maxAge', () => {
let path = `/resources/TRELLIS-MONITOR-TEST-${ksuid.randomSync().string}`;
delay = 1001;

test.before(async () => {
  await oada.put({ path, data: {}, contentType: 'application/json' });
  await setTimeout(delay); // Wait 1 s should be sufficient to test age
});

test.after(async () => {
  await oada.delete({ path });
});

test('should have status: success for recently-created resource', async () => {
  const result = await maxAge({ path, maxage: 2 * delay, oada });
  expect(result.status).to.equal('success');
});

test('should have status: failure for old resource with short maxage', async () => {
  const result = await maxAge({ path, maxage: 0.5 * delay, oada });
  expect(result.status).to.equal('failure');
});
//});

//describe('#staleKsuidKeys', () => {
path = `/resources/TRELLIS-MONITOR-TEST-${ksuid.randomSync().string}`;
const newKSUID = ksuid.randomSync().string;
const oldKSUID = ksuid.randomSync(new Date('2021-02-03T01:00:00Z')).string;
test.before(async () => {
  await oada.put({ path, data: {}, contentType: 'application/json' });
  await setTimeout(1001); // Wait 1 s should be sufficient to test age
});

test.after(async () => oada.delete({ path }));

test('should have status: success for resource w/ recent ksuid key', async () => {
  await oada.put({
    path,
    data: { [newKSUID]: true },
    contentType: 'application/json',
  });
  const result = await staleKsuidKeys({ path, maxage: 60, oada });
  await oada.delete({ path: `${path}/newksuid` });
  expect(result).to.deep.equal({ status: 'success' });
});

test('should have status: failure for resource w/ old ksuid key', async () => {
  await oada.put({
    path,
    data: { [oldKSUID]: true },
    contentType: 'application/json',
  });
  const result = await staleKsuidKeys({ path, maxage: 1, oada });
  await oada.delete({ path: `${path}/oldksuid` });
  expect(result.status).to.equal('failure');
});
//});

//describe('#countKeys', () => {
const parentID = `resources/TRELLIS-MONITOR-TEST-${ksuid.randomSync().string}`;
const indexID = `resources/TRELLIS-MONITOR-TEST-${ksuid.randomSync().string}`;

test.before(async () => {
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
  await oada.delete({ path: `/${parentID}` });
  await oada.delete({ path: `/${indexID}` });
});

test('should have status: success and count=2 for resource w/ 2 keys', async () => {
  const result = await countKeys({
    path: `/${parentID}`,
    index: 'day-index',
    oada,
  });
  expect(result.status).to.equal('success');
  expect(result.count).to.equal(2);
});
//});

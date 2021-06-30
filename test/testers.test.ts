/* Copyright 2021 Qlever LLC
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

import { expect } from 'chai';
import { connect, OADAClient } from '@oada/client';
import ksuid from 'ksuid';
import config from '../src/config';
import Bluebird from 'bluebird';
import moment from 'moment';
import { pathTest, maxAge, relativeAge, staleKsuidKeys, countKeys } from '../src/testers';

const domain = config.get('oada.domain');
const token = config.get('oada.token');

describe('testers', () => {
  let oada: OADAClient;

  before(async () => {
    oada = await connect({ domain, token, connection: 'http' });
  });

  after(async() => await oada.disconnect());

  describe('#pathTest', () => {
    it('should have status: success for well-known', async () => {
      const result = await pathTest({
        path: '/.well-known/oada-configuration',
        oada,
      });
      expect(result).to.deep.equal({ status: 'success' });
    });

    it('should have status: success for bookmarks', async () => {
      const result = await pathTest({ path: '/bookmarks', oada });
      expect(result.status).to.equal('success');
    });

    it('should have status: failure for nonexistent resource', async () => {
      const result = await pathTest({
        path: '/resources/idonotexist57993',
        oada,
      });
      expect(result.status).to.equal('failure');
    });
  });

  describe('#relativeAge', () => {
    const leader = '/resources/TRELLIS-MONITOR-TEST-' + ksuid.randomSync().string;
    const delay = 1000;
    const fast_follower = '/resources/TRELLIS-MONITOR-TEST-' + ksuid.randomSync().string;
    const slow_follower = '/resources/TRELLIS-MONITOR-TEST-' + ksuid.randomSync().string;

    before(async () => {
      // "slow_follower" should be stale, i.e. must be BEFORE leader writes
      await oada.put({ path: slow_follower, data: {}, contentType: 'application/json' });
      await Bluebird.delay(delay); // wait 1 s
      // "slow_follower" will be ~1 sec older than leader, but it should be newer than leader
      await oada.put({ path: leader, data: {}, contentType: 'application/json' });
      // "fast_follower" will be the newest timestamp of all, regardless of delay, and is AFTER leader
      await oada.put({ path: fast_follower, data: {}, contentType: 'application/json' });
    });

    after(async () => {
      await oada.delete({ path: leader });
      await oada.delete({ path: slow_follower });
      await oada.delete({ path: fast_follower });
    });

    it('should have status: success for fast follower AFTER leader', async () => {
      const result = await relativeAge({ leader, follower: fast_follower, maxage: delay, oada });
      expect(result.status).to.equal('success');
    });

    it('should have status: failure for slow follower more than maxage BEFORE leader', async () => {
      const result = await relativeAge({ leader, follower: slow_follower, maxage: 0.5 * delay, oada });
      expect(result.status).to.equal('failure');
    });

    it('should have status: success for slow follower less than maxage BEFORE leader', async() => {
      const result = await relativeAge({ leader, follower: slow_follower, maxage: 2 * delay, oada });
      expect(result.status).to.equal('success');
    });
    
  });


  describe('#maxAge', () => {
    const path = '/resources/TRELLIS-MONITOR-TEST-' + ksuid.randomSync().string;
    const delay = 1001;

    before(async () => {
      await oada.put({ path, data: {}, contentType: 'application/json' });
      await Bluebird.delay(delay); // wait 1 s should be sufficient to test age
    });

    after(async () => {
      await oada.delete({ path });
    });

    it('should have status: success for recently-created resource', async () => {
      const result = await maxAge({ path, maxage: 2*delay, oada });
      expect(result.status).to.equal('success');
    });

    it('should have status: failure for old resource with short maxage', async () => {
      const result = await maxAge({ path, maxage: 0.5*delay, oada });
      expect(result.status).to.equal('failure');
    });
  });

  describe('#staleKsuidKeys', () => {
    const path = '/resources/TRELLIS-MONITOR-TEST-' + ksuid.randomSync().string;
    const newksuid = ksuid.randomSync().string;
    const oldksuid = ksuid.randomSync(new Date('2021-02-03T01:00:00Z')).string;
    before(async () => {
      await oada.put({ path, data: {}, contentType: 'application/json' });
      await Bluebird.delay(1001); // wait 1 s should be sufficient to test age
    });

    after(async () => oada.delete({ path }));

    it('should have status: success for resource w/ recent ksuid key', async () => {
      await oada.put({
        path,
        data: { [newksuid]: true },
        contentType: 'application/json',
      });
      const result = await staleKsuidKeys({ path, maxage: 60, oada });
      await oada.delete({ path: `${path}/newksuid` });
      expect(result).to.deep.equal({ status: 'success' });
    });

    it('should have status: failure for resource w/ old ksuid key', async () => {
      await oada.put({
        path,
        data: { [oldksuid]: true },
        contentType: 'application/json',
      });
      const result = await staleKsuidKeys({ path, maxage: 1, oada });
      await oada.delete({ path: `${path}/oldksuid` });
      expect(result.status).to.equal('failure');
    });
  });

  describe('#countKeys', () => {
    const parentid =
      'resources/TRELLIS-MONITOR-TEST-' + ksuid.randomSync().string;
    const indexid =
      'resources/TRELLIS-MONITOR-TEST-' + ksuid.randomSync().string;

    before(async () => {
      await oada.put({
        path: `/${indexid}`,
        data: { key1: 'val1', key2: 'val2' },
        contentType: 'application/json',
      });
      await oada.put({
        path: `/${parentid}`,
        data: {
          'day-index': {
            [moment().format('YYYY-MM-DD')]: { _id: indexid, _rev: 0 },
          },
        },
        contentType: 'application/json',
      });
    });
    after(async () => {
      await oada.delete({ path: `/${parentid}` });
      await oada.delete({ path: `/${indexid}` });
    });

    it('should have status: success and count=2 for resource w/ 2 keys', async () => {
      const result = await countKeys({
        path: `/${parentid}`,
        index: 'day-index',
        oada,
      });
      expect(result.status).to.equal('success');
      expect(result.count).to.equal(2);
    });
  });
});

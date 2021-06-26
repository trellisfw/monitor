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
import ksuid from 'ksuid';
import Bluebird from 'bluebird';
import tiny from 'tiny-json-http';
import _ from 'lodash';
import debug from 'debug';

import { connect, OADAClient } from '@oada/client';

import config from '../src/config';

const trace = debug('trellis-monitor:trace');

const domain = config.get('oada.domain');
const token = config.get('oada.token');
const incomingToken = config.get('server.token');

trace('Connecting to oada w/ domain = %s and token = %s', domain, token);

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
          _type: 'applicaiton/vnd.oada.service.jobs.1+json',
        },
      },
    },
  },
};

// In watch mode, these tests need to wait for service to restart.  package.json adds `--delay` to
// mocha in this case: it will wait to run our tests until we call "run".  Code for that is at bottom.

describe('service', () => {
  let oada: OADAClient;
  before(async () => {
    oada = await connect({ domain, token, connection: 'http' });
    // Setup the trees that it is expecting to be there
    await ensurePath(`/bookmarks/trellisfw/asn-staging`, oada);
    await ensurePath(`/bookmarks/trellisfw/asns`, oada);
    await ensurePath(`/bookmarks/services/target/jobs`, oada);
  });

  it('should fail on check after posting stale asn-staging ksuid key', async () => {
    const oldksuid = ksuid.randomSync(new Date('2021-02-03T01:00:00Z')).string;
    const path = `/bookmarks/trellisfw/asn-staging`;
    await oada.put({
      path,
      data: { [oldksuid]: { istest: true } },
      contentType: 'application/json',
    });
    const url = `http://localhost:${config.get('server.port')}/trigger`;
    trace('Getting trigger at url ', url);

    let service_is_running = false;
    let status = '';
    try {
      const res = await tiny.get({
        url,
        headers: { authorization: `Bearer ${incomingToken}` },
      });
      service_is_running = true;
      status = _.get(res!.body, 'tests.staging_clean.status');
      trace('Done w/ trigger, checking body: ', res.body);
    } catch (e) {
      if (e.code !== 'ECONNREFUSED') { // service is running, but something went wrong
        throw e;
      }
      trace('Service does not appear to be running, skipping this test');
      service_is_running = false; // service isn't running, test is irrelevant
    }
    // Cleanup the stale ksuid before testing:
    await oada.delete({ path: `${path}/${oldksuid}` });
    // Only perform the expectation if service is actually running:
    if (service_is_running) {
      expect(status).to.equal('failure');
    }
  });
});

if (run) {
  console.log(
    '--delay passed, waiting 2 seconds before starting service tests'
  );
  Bluebird.delay(2000).then(() => {
    console.log('Done waiting, starting service tests');
    run();
  });
}

async function ensurePath(path: string, oada: OADAClient) {
  await oada.head({ path }).catch(async (e) => {
    if (e.status === 404) {
      console.log(
        'ensurePath: path ' + path + ' did not exist before test, creating'
      );
      await oada.put({ path, tree, data: {} });
      return;
    }
    console.log(
      'ERROR: ensurePath: HEAD to path ' +
        path +
        ' returned non-404 error status: ',
      e
    );
  });
}

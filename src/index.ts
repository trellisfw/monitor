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

import { readdir } from 'fs/promises';
import { join } from 'path';

import Bluebird from 'bluebird';
import _ from 'lodash'; // Lazy, lodash isn't really needed anymore;
import debug from 'debug';
import express from 'express';
import uuid from 'uuid';
import moment from 'moment';
import cron from 'node-cron';
import micromatch from 'micromatch';

import { Change, connect } from '@oada/client';

import * as testers from './testers';
import * as notifiers from './notifiers';

import testasn from './testasn';

import config from './config';

const error = debug('trellis-monitor:error');
const info = debug('trellis-monitor:info');
const warn = debug('trellis-monitor:warn');
const trace = debug('trellis-monitor:trace');

const incomingToken = config.get('server.token');
const port = config.get('server.port');
const tokenToRequestAgainstOADA = config.get('oada.token');
let domain = config.get('oada.domain');
if (!domain.match(/^http/)) {
  domain = 'https://' + domain;
}

const cronschedule = config.get('notify.cron');
const notifyurl = config.get('notify.url');
const timeout = config.get('timeout');
const notifyname = config.get('notify.name') || config.get('oada.domain');

/**
 * The format of a test description
 *
 * Each test file should export and object of tests
 */
export interface Test<P = unknown> {
  /**
   * Description of test
   */
  desc: string;
  /**
   * Tester to use
   */
  type: keyof typeof testers;
  /**
   * Parameters for tester
   */
  params: P;
}

const testdir = config.get('tests.dir');
const testmatch = config.get('tests.enabled').split(',');

async function run() {
  info('Starting monitor with cron = %s', cronschedule);

  const oada = await connect({
    domain,
    token: tokenToRequestAgainstOADA,
    connection: 'http', // no need to keep open websockets
  }).catch((e) => {
    error('ERROR: failed to connect to OADA. The error was: %O', e);
    throw e;
  });
  trace(
    'Connected to oada, domain = %s, token = %s',
    domain,
    tokenToRequestAgainstOADA
  );

  // Is well-known up w/ SSL?
  // Is bookmarks up w/ test token?
  // Any jobs in Target queue w/ update longer than 30 mins ago?
  // asn-staging: if last _rev is more than 5 mins old, and we still have keys in asn-staging, error
  // asn-staging: if last _rev more than 12 hours old, error
  // asns/day-index: count the number of keys today for reporting
  // We will refrain from posting a dummy ASN for now, can use "postOne" if we want to.

  const status = {
    global: {
      // Report which server this was?
      server: notifyname,
      status: 'failure',
      lastruntime: 'never',
    },
    tests: {},
  };

  // Load monitor tests
  const tests: Record<string, Test> = {};
  info('Loading all monitor tests from %s', testdir);
  const testfiles = await readdir(testdir);
  for (const t of testfiles) {
    const file = join(testdir, t);
    // Load tests from file
    const tf = (await import(file)) as Record<string, Test>;
    trace('Loaded monitor tests from %s', file);

    // Find any enabled tests
    const enabled = micromatch(Object.keys(tf), testmatch);
    trace('Enabling monitor tests %o from %s', enabled, tf);
    for (const t of enabled) {
      tests[t] = tf[t]!;
    }
  }

  //-------------------------------------------------------
  // Trigger testing on a schedule:
  const check = async () => {
    try {
      trace('Running tests');
      const testkeys = _.keys(tests);
      const results = await Bluebird.map(
        testkeys,
        async (tk: keyof typeof tests) => {
          trace('Running test %s', tk);
          try {
            const t = tests[tk]!;
            const runner = testers[t.type];
            if (!runner) {
              return { status: 'failure', message: 'Invalid tester type' };
            }
            return await runner({
              oada,
              //@ts-ignore
              ...t.params,
            });
          } catch (e) {
            error('Test %s threw uncaught exception: %O', tk, e);
            return {
              status: 'failure',
              message: `Uncaught exception: ${e.toString()}`,
            };
          }
        },
        { concurrency: 1 }
      );

      trace('Results of tests: %O', results);
      status.tests = _.zipObject(testkeys, results);
      const failures = _.filter(
        results,
        (r) => !r.status || r.status !== 'success'
      );
      trace('Results filtered to failures = %O', failures);
      status.global.status = failures.length < 1 ? 'success' : 'failure';
      status.global.lastruntime = moment().format('YYYY-MM-DD HH:mm:ss');

      if (status.global.status === 'success') {
        info(`${moment().format('YYYY-MM-DD HH:mm:ss')}: Tests all successful`);
        return;
      }

      info('Failure: sending notification.  Failure status is: %O', status);
      if (notifyurl) {
        trace("Posting message to config.get('notify.url') = %s", notifyurl);
        try {
          notifiers.notifySlack(notifyurl, status);
        } catch (e) {
          error('FAILED TO NOTIFY SLACK! Error was: %s', e);
        }
      }
    } catch (e) {
      error('check: Uncaught error from main check. Error was: %s', e);
    }
  };
  // Run the check immediately on start, then schedule the intervals
  info('Running initial check');
  await check();
  info(
    'Completed initial check, starting re-check on cron string %s',
    cronschedule
  );
  cron.schedule(cronschedule, check);
  info('Started monitor');

  //------------------------------------------------------------------------------
  //
  // Check the monitor from outside for success:
  //
  // Start the express server listening for requests from a monitor:
  const app = express();
  //---------------------------------------------------
  // Ask from outside how things are going:
  // /trellis-monitor -> return global status from last run of check()
  app.get('/', async (req, res) => {
    if (!req || !req.headers) {
      trace('no headers!');
      return res.end();
    }
    if (req.headers.authorization !== 'Bearer ' + incomingToken) {
      info('Request for check: Not the right token');
      return res.end();
    }

    info(
      'Responding to request with current global status %O',
      status.global.status
    );
    res.json(status);

    res.end();
  });
  // /trellis-monitor/trigger -> run check(), then return global status
  app.get('/trigger', async (req, res) => {
    if (!req || !req.headers) {
      trace('no headers!');
      return res.end();
    }
    if (req.headers.authorization !== 'Bearer ' + incomingToken) {
      info('Request for check: Not the right token');
      return res.end();
    }

    info('trigger: triggering extra run of check() based on request');
    await check();
    info(
      'trigger: Responding to request with current global status %O',
      status.global.status
    );
    res.json(status);

    res.end();
  });

  // proxy routes https://<domain>/trellis-monitor to us on 80
  app.listen(port, () => info('@trellisfw/monitor listening on port %d', port));
}

run();

async function postOne() {
  let newkey = false;
  const con = await connect({
    domain,
    token: tokenToRequestAgainstOADA,
    // @ts-ignore
    cache: false,
  });
  try {
    trace('Connected to OADA, retrieving current target job queue');
    const queue = await con
      .get({ path: '/bookmarks/services/target/jobs' })
      .then((r) => r.data);
    const validkeys = _.filter(_.keys(queue), (k) => !k.match(/^_/)); // remove any OADA keys like _id, _rev, _meta
    if (validkeys.length > 10) {
      error('Target job queue is longer than 10 items, not posting new ASN');
      throw new Error(
        'Target job queue is longer than 10 items, not posting new ASN'
      );
    }

    trace('Job queue sufficiently small (< 10), posting test ASN');

    const now = moment().utc().format('X');
    const rand = uuid.v4().replace(/-/g, '').slice(0, 15);
    const newkey = `MONITOR-${now}-${rand}`;
    await con
      .put({
        path: `/bookmarks/trellisfw/asn-staging/${newkey}`,
        data: testasn as any,
        contentType: 'application/vnd.trellisfw.asn-staging.sf.1+json',
      })
      .then((r) => r.headers['content-location']?.slice(1))
      .catch((e) => {
        error('FAILED to post ASN to asn-staging!  error was: ', e);
        throw new Error(
          'FAILED to post ASN to asn-staging!  error was: ' +
            JSON.stringify(e, null, '  ')
        );
      });
    info('Document posted to asn-staging as new key', newkey);

    const p = new Bluebird(async (resolve, reject) => {
      try {
        // Set a timer to timeout when waiting
        setTimeout(() => {
          if (!p.isFulfilled()) {
            error(
              'TIMEOUT: took longer than %d ms to fulfill, returning error!',
              timeout
            );
            reject('TIMEOUT: took longer than ' + timeout + 'ms to fulfill');
          }
        }, timeout);
        // Create watch handler
        function watchHandler(change: Readonly<Change>) {
          if (!change || change.type !== 'merge') {
            trace(
              'received change, but was not a merge.  change was: ',
              change
            );
            return;
          }
          // @ts-ignore
          if (!change.body[newkey]) {
            trace(
              'received change, but was not to the new key.  change was: ',
              change
            );
            return;
          }
          trace(
            `Received change on ${newkey}, will check if it is meta as "asset created"`
          );
          // @ts-ignore
          const meta = change.body[newkey]._meta;
          trace('change meta = ', meta);
          if (!meta) {
            trace('received change, and to the right key, but not to meta');
            return;
          }
          const target =
            meta.services && meta.services.target && meta.services.target.tasks;
          if (!target) {
            trace(
              'received change, and to the right key w/ meta, but not to meta.services.target.tasks'
            );
            return;
          }
          // JSON.stringify to make looking through all tasks much simpler
          const str = JSON.stringify(target);
          if (str.match(/asset[ _-]+created/i)) {
            trace('received change, asset is created, resolving promise');
            trace('successful change was: ', change);
            // @ts-ignore
            return resolve(change.body[newkey]._rev);
          }
          trace('received change, but nothing matches "asset created"');
        }
        // Set a watch on asn's, look for this key to show up
        await con.get({
          path: '/bookmarks/trellisfw/asns',
          watchCallback: watchHandler,
        });
      } catch (e) {
        error('FAILED waiting for success, never saw it');
        //res.json({ error: true, message: JSON.stringify(e, null, '  ') });
        throw e;
      }
    });
    //const success_rev = await p;
    info('Overall test successful on key ', newkey);
    //currentlysuccess = true;
    //latestmessage = `ASN push to IFT succeeded on id ${newkey} on rev ${success_rev}`;
  } catch (e) {
    error('FAILED waiting for success, never saw it');
    //currentlysuccess = false;
    //latestmessage = JSON.stringify(e, false, '  ');
  } finally {
    // Delete the asn-staging entry, the asns entry, and the resource itself
    if (newkey) {
      warn(
        'You have commented all the deletes, so all monitor-generated ASN resources will stay there.'
      );
      /*
      try {
        await Promise.all([
          con.get({path:`/bookmarks/trellisfw/asn-staging/${newkey}`})
            .then(() => con.delete({ path: `/bookmarks/trellisfw/asn-staging/${newkey}`, headers: { 'content-type': 'application/json' } }))
            .catch(e => warn(`/bookmarks/trellisfw/asn-staging/${newkey} did not exist to delete when done.  Error was: `,(e.response.status===404?e.response.status:e))),

          con.get({ path: `/bookmarks/trellisfw/asns/${newkey}` })
            .then(() => con.delete({ path: `/bookmarks/trellisfw/asns/${newkey}`, headers: { 'content-type': 'application/json' } }))
            .catch(e => warn(`/bookmarks/trellisfw/asns/${newkey} did not exist to delete when done.  Error was: `,(e.response.status===404?e.response.status:e))),

          con.get({ path: `/resources/${newkey}` })
            .then(() => con.delete({ path: `/resources/${newkey}`, headers: { 'content-type': 'application/json' } }))
            .catch(e => warn(`/resources/${newkey} did not exist to delete when done.  Error was `,(e.response.status===404?e.response.status:e))),
        ]);
      } catch(e) {
        error('FAILED on cleanup of resources.  Alreay sent error, so failing silently.');
      }
      */
    }
    con.disconnect();
    trace('DONE!');
  }
}

export { postOne };

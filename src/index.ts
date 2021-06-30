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
import debug from 'debug';
import express from 'express';
import moment from 'moment';
import cron from 'node-cron';
import micromatch from 'micromatch';

import { connect, OADAClient } from '@oada/client';

import * as testers from './testers';
import type { TestResult as ITestResult } from './testers';
import * as notifiers from './notifiers';

import config from './config';

const error = debug('trellis-monitor:error');
const info = debug('trellis-monitor:info');
//const warn = debug('trellis-monitor:warn');
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
   * domain for this test (optional, defaults to oada.domain in config)
   */
  domain?: string;
  /**
   * token for this test (optional, defaults to oada.token in config)
   */
  token?: string;
  /**
   * Parameters for tester
   */
  params: P;
}

// Re-export TestResult type
export type TestResult = ITestResult;

// Type of the "status" that is reported globally:
export interface Status {
  global: {
    server: string;
    status: 'failure' | 'success';
    lastruntime: string;
  };
  tests: {
    [key: string]: TestResult;
  }
};


// Each "final" test that we store will have the oada connection, domain, and token stored in it
interface ValidTest<P = unknown> {
  name: string;
  desc: string;
  type: keyof typeof testers;
  params: P;
  domain: string;
  token: string;
  oada: OADAClient;
}

const testdir = config.get('tests.dir');
const testmatch = config.get('tests.enabled').split(',');

async function run() {
  info('Starting monitor with cron = %s', cronschedule);


  // Is well-known up w/ SSL?
  // Is bookmarks up w/ test token?
  // Any jobs in Target queue w/ update longer than 30 mins ago?
  // asn-staging: if last _rev is more than 5 mins old, and we still have keys in asn-staging, error
  // asn-staging: if last _rev more than 12 hours old, error
  // asns/day-index: count the number of keys today for reporting
  // We will refrain from posting a dummy ASN for now, can use "postOne" if we want to.

  const status: Status = {
    global: {
      // Report which server this was?
      server: notifyname,
      status: 'failure',
      lastruntime: 'never',
    },
    tests: {},
  };

  // Load monitor tests
  const rawtests: Record<string, Test> = {};
  info('Loading all monitor tests from %s', testdir);
  const testfiles = await readdir(testdir);
  for (const t of testfiles) {
    const file = join(testdir, t);
    // Load tests from file
    const tf = (await import(file)) as Record<string, Test>;
    trace('Loaded monitor tests %o from %s', Object.keys(tf), file);

    // Find any enabled tests
    const enabled = micromatch(Object.keys(tf), testmatch);
    trace('Enabling monitor tests %o from %s', enabled, tf);
    for (const t of enabled) {
      if (t === 'default') continue; // module.exports in the JS file results in an extra "default" key.  Cannot name a test "default"
      rawtests[t] = tf[t]!;
    }
  }

  // Add default domain/token to any tests that do not have it,
  // and while we're at it open oada connections for all unique domain/token pairs
  const tests: Record<string, ValidTest> = {};
  const oadapool: Record<string, OADAClient> = {};
  for (const key of Object.keys(rawtests)) {
    const rawtest = rawtests[key]!;
    const d = rawtest.domain || domain;
    const t = rawtest.token || tokenToRequestAgainstOADA;
    const pi = `${d}::${t}`; // index into oada connection pool (same connection for same domain/token)
    // Do we already have an open connection to this domain/token?
    if (!oadapool[pi]) {
      oadapool[pi] = await connect({domain: d, token: t, connection: 'http'})
        .catch((e: unknown) => {
          error(`ERROR: failed to connect to OADA for domain ${d} and token ${t}.  Error was: %0`, e);
          throw e;
        })
    }
    // Create the final set of validated tests w/ included oada connection:
    tests[key] = {
      name: key,
      domain: rawtest.domain || domain, // default to global domain from config
      token: rawtest.token || tokenToRequestAgainstOADA, // default to token from config
      ...rawtest,
      oada: oadapool[pi]!,
    };
  }


  //-------------------------------------------------------
  // Trigger testing on a schedule:
  const check = async () => {
    try {
      const testkeys = Object.keys(tests);
      trace(`Running ${testkeys.length} tests`);
      let results: TestResult[] = await Bluebird.map(
        testkeys,
        async (tk: keyof typeof tests) => {
          trace('Running test %s', tk);
          try {
            const t = tests[tk]!;
            const runner = testers[t.type];
            if (!runner) {
              return { 
                status: 'failure', 
                message: `Invalid tester type ${t.type}.  Valid types are: ${Object.keys(testers).join(', ')}` 
              };
            }
            return await runner({
              oada: t.oada,
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
      // "status.tests" key should have same keys as tests here, but the values are the results of that test
      status.tests = testkeys.reduce((acc,tk,index) => ({ 
        ...acc, 
        [tk]: results[index] 
      }), {});
      // Walk all the tests and augment with description from the test for any failures:
      for (const testkey of Object.keys(status.tests)) {
        const result = status.tests[testkey]!;
        if (status.tests[testkey]!.status === 'success') continue; // leave success tests w/o a desc for brevity
        if (status.tests[testkey]!.desc) continue; // alrady has a desc from the test itself, leave it alone
        if (tests[testkey]!.desc) {
          result.desc = tests[testkey]!.desc; // if there is a desc on the test, include it here
        }
      }

          
      const failures = results.filter(
        (r: TestResult) => !r.status || r.status !== 'success'
      );
      trace('Results filtered to failures = %O', failures);
      status.global.status = failures.length < 1 ? 'success' : 'failure';
      status.global.lastruntime = moment().format('YYYY-MM-DD HH:mm:ss');

      if (status.global.status === 'success') {
        info(`${status.global.lastruntime}: Tests all successful`);
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


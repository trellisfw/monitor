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

import { join } from 'node:path';
import { readdir } from 'node:fs/promises';

import cron from 'node-cron';
import debug from 'debug';
import express from 'express';
import micromatch from 'micromatch';
import moment from 'moment';

import { OADAClient, connect } from '@oada/client';

// eslint-disable-next-line import/no-namespace
import * as testers from './testers';
import type { TestResult as ITestResult } from './testers';
import { notifySlack } from './notifiers';

import config from './config';

const error = debug('trellis-monitor:error');
const info = debug('trellis-monitor:info');
const trace = debug('trellis-monitor:trace');

const incomingToken = config.get('server.token');
const port = config.get('server.port');
const tokenToRequestAgainstOADA = config.get('oada.token');
let domain = config.get('oada.domain');
if (!domain.startsWith('http')) {
  domain = `https://${domain}`;
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
   * Domain for this test (optional, defaults to oada.domain in config)
   */
  domain?: string;
  /**
   * Token for this test (optional, defaults to oada.token in config)
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
  tests: Record<string, TestResult>;
}

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
const rawtests: Map<string, Test> = new Map();
info('Loading all monitor tests from %s', testdir);
const testfiles = await readdir(testdir);
for (const t of testfiles) {
  const file = join(testdir, t);
  // Load tests from file
  // eslint-disable-next-line no-await-in-loop
  const tf = (await import(file)) as Record<string, Test>;
  trace('Loaded monitor tests %o from %s', Object.keys(tf), file);

  // Find any enabled tests
  const enabled = micromatch(Object.keys(tf), testmatch);
  trace('Enabling monitor tests %o from %s', enabled, tf);
  for (const te of enabled) {
    if (te === 'default') {
      // Module.exports in the JS file results in an extra "default" key.  Cannot name a test "default"
      continue;
    }

    rawtests.set(te, tf[te]!);
  }
}

// Add default domain/token to any tests that do not have it,
// and while we're at it open oada connections for all unique domain/token pairs
const tests: Map<string, ValidTest> = new Map();
const oadaPool: Map<string, OADAClient> = new Map();
for (const [key, rawtest] of rawtests) {
  const d = rawtest.domain ?? domain;
  const t = rawtest.token ?? tokenToRequestAgainstOADA;
  const pi = `${d}::${t}`; // Index into oada connection pool (same connection for same domain/token)
  // Do we already have an open connection to this domain/token?
  if (!oadaPool.has(pi)) {
    try {
      oadaPool.set(
        pi,
        // eslint-disable-next-line no-await-in-loop
        await connect({
          domain: d,
          token: t,
          connection: 'http',
        })
      );
    } catch (cError: unknown) {
      error(
        cError,
        `ERROR: failed to connect to OADA for domain ${d} and token ${t}.  Error was: %0`
      );
      throw cError;
    }
  }

  // Create the final set of validated tests w/ included oada connection:
  tests.set(key, {
    name: key,
    domain: rawtest.domain ?? domain, // Default to global domain from config
    token: rawtest.token ?? tokenToRequestAgainstOADA, // Default to token from config
    ...rawtest,
    oada: oadaPool.get(pi)!,
  });
}

// -------------------------------------------------------
// Trigger testing on a schedule:
const check = async () => {
  try {
    trace('Running %d tests', tests.size);
    const results: TestResult[] = [];
    for (const [tk, t] of tests) {
      trace('Running test %s', tk);
      try {
        // eslint-disable-next-line import/namespace
        const runner = testers[t.type];
        if (!runner) {
          return {
            status: 'failure',
            message: `Invalid tester type ${
              t.type
            }.  Valid types are: ${Object.keys(testers).join(', ')}`,
          };
        }

        results.push(
          // eslint-disable-next-line no-await-in-loop
          await runner({
            oada: t.oada,
            // @ts-expect-error stuff
            ...t.params,
          })
        );
      } catch (cError: unknown) {
        error('Test %s threw uncaught exception: %O', tk, cError);
        return {
          status: 'failure',
          message: `Uncaught exception: ${cError}`,
        };
      }
    }

    trace(results, 'Results of tests');
    // "status.tests" key should have same keys as tests here, but the values are the results of that test
    status.tests = Object.fromEntries(
      Object.keys(tests).map((tk, index) => [tk, results[Number(index)]!])
    );
    // Walk all the tests and augment with description from the test for any failures:
    for (const [testkey, result] of Object.entries(status.tests)) {
      if (result.status === 'success') {
        // Leave success tests w/o a desc for brevity
        continue;
      }

      if (result.desc) {
        // Already has a desc from the test itself, leave it alone
        continue;
      }

      if (tests.get(testkey)?.desc) {
        // If there is a desc on the test, include it here
        result.desc = tests.get(testkey)?.desc;
      }
    }

    const failures = results.filter(
      (r: TestResult) => !r.status || r.status !== 'success'
    );
    trace(failures, 'Results filtered to failures');
    status.global.status = failures.length === 0 ? 'success' : 'failure';
    status.global.lastruntime = moment().format('YYYY-MM-DD HH:mm:ss');

    if (status.global.status === 'success') {
      info('%s: Tests all successful', status.global.lastruntime);
      return;
    }

    info('Failure: sending notification. Failure status is: %O', status);
    if (notifyurl) {
      trace("Posting message to config.get('notify.url') = %s", notifyurl);
      try {
        await notifySlack(notifyurl, status);
      } catch (cError: unknown) {
        error(cError, 'FAILED TO NOTIFY SLACK!');
      }
    }
  } catch (cError: unknown) {
    error(cError, 'check: Uncaught error from main check');
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

// ------------------------------------------------------------------------------
//
// Check the monitor from outside for success:
//
// Start the express server listening for requests from a monitor:
const app = express();
// ---------------------------------------------------
// Ask from outside how things are going:
// /trellis-monitor -> return global status from last run of check()
app.get('/', async (request, response) => {
  if (!request || !request.headers) {
    trace('no headers!');
    response.end();
    return;
  }

  if (request.headers.authorization !== `Bearer ${incomingToken}`) {
    info('Request for check: Not the right token');
    response.end();
    return;
  }

  info(
    'Responding to request with current global status %O',
    status.global.status
  );
  response.json(status);

  response.end();
});
// /trellis-monitor/trigger -> run check(), then return global status
app.get('/trigger', async (request, response) => {
  if (!request || !request.headers) {
    trace('no headers!');
    response.end();
    return;
  }

  if (request.headers.authorization !== `Bearer ${incomingToken}`) {
    info('Request for check: Not the right token');
    response.end();
    return;
  }

  info('trigger: triggering extra run of check() based on request');
  await check();
  info(
    'trigger: Responding to request with current global status %O',
    status.global.status
  );
  response.json(status);

  response.end();
});

// Proxy routes https://<domain>/trellis-monitor to us on 80
app.listen(port, () => {
  info('@trellisfw/monitor listening on port %d', port);
});

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
import * as testers from './testers.js';
import type { TestResult as ITestResult } from './testers.js';
import { notifySlack } from './notifiers.js';

import config from './config.js';

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

const notifyCron = config.get('notify.cron');
const reminderCron = config.get('notify.reminderCron');
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

info('Starting monitor with cron = %s', notifyCron);

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
const failures: Map<string, TestResult> = new Map();

// Load monitor tests
const rawtests: Map<string, Test> = new Map();
info('Loading all monitor tests from %s', testdir);
const testfiles = await readdir(testdir);
for (const t of testfiles) {
  const file = join(testdir, t);

  // Load tests from file
  let testsFile: Record<string, Test>;
  try {
    // eslint-disable-next-line no-await-in-loop
    testsFile = (await import(file)) as Record<string, Test>;
  } catch {
    // eslint-disable-next-line no-await-in-loop
    testsFile = (await import(join(file, 'index.js'))) as Record<string, Test>;
  }

  const tests = Object.keys(testsFile);
  trace('Loaded monitor tests %O from %s', tests, file);

  // Find any enabled tests
  const enabled = micromatch(tests, testmatch);
  trace('Enabling monitor tests %O from %s', enabled, testsFile);
  for (const te of enabled) {
    if (te === 'default') {
      // Module.exports in the JS file results in an extra "default" key.  Cannot name a test "default"
      continue;
    }

    // eslint-disable-next-line security/detect-object-injection
    rawtests.set(te, testsFile[te]!);
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
        })
      );
    } catch (cError: unknown) {
      error(cError, `Failed to connect to OADA for domain ${d} and token ${t}`);
      throw cError as Error;
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

async function updateFailures(
  results: Map<string, TestResult>,
  quiet: readonly string[] = []
) {
  failures.clear();
  for (const [tk, r] of results) {
    if (r.status !== 'success') {
      failures.set(tk, r);
    }
  }

  trace(failures, 'Results filtered to failures');
  status.global.status = failures.size === 0 ? 'success' : 'failure';
  status.global.lastruntime = moment().format('YYYY-MM-DD HH:mm:ss');

  if (status.global.status === 'success') {
    info('%s: Tests all successful', status.global.lastruntime);
    return;
  }

  info(status, 'Failure: sending notification.');
  if (notifyurl) {
    trace("Posting message to config.get('notify.url') = %s", notifyurl);
    try {
      if (Array.from(failures.keys()).some((tk) => !quiet.includes(tk))) {
        await notifySlack(notifyurl, status);
      }
    } catch (cError: unknown) {
      error(cError, 'FAILED TO NOTIFY SLACK!');
    }
  }
}

async function doCheck(quiet: readonly string[] = []) {
  checking = true;
  trace('Running %d tests', tests.size);
  const results: Map<string, TestResult> = new Map();
  for await (const [tk, t] of tests) {
    trace('Running test %s', tk);
    try {
      const runner = testers[t.type];
      if (!runner) {
        results.set(tk, {
          status: 'failure',
          message: `Invalid tester type ${
            t.type
          }.  Valid types are: ${Object.keys(testers).join(', ')}`,
        });
        continue;
      }

      results.set(
        tk,
        await runner({
          oada: t.oada,
          // @ts-expect-error stuff
          ...t.params,
        })
      );
    } catch (cError: unknown) {
      error(cError, `Test ${tk} threw an uncaught exception`);
      results.set(tk, {
        status: 'failure',
        message: `Uncaught exception: ${cError}`,
      });
    }
  }

  trace(results, 'Results of tests');
  // "status.tests" key should have same keys as tests here, but the values are the results of that test
  status.tests = Object.fromEntries(
    Array.from(tests.keys(), (tk) => [tk, results.get(tk)!])
  );
  // Walk all the tests and augment with description from the test for any failures:
  for (const [testkey, result] of Object.entries(status.tests)) {
    if (result.status === 'success') {
      // Leave success tests w/o a desc for brevity
      continue;
    }

    if ('desc' in result) {
      // Already has a desc from the test itself, leave it alone
      continue;
    }

    // If there is a desc on the test, include it here
    result.desc = tests.get(testkey)?.desc;
  }

  // Find failing tests
  await updateFailures(results, quiet);
}

// -------------------------------------------------------
// Trigger testing on a schedule:
let checking = false; // Prevent concurrent check runs?
async function check(quiet: readonly string[] = []) {
  if (checking) {
    // Check is already running
    return;
  }

  try {
    await doCheck(quiet);
  } catch (cError: unknown) {
    error(cError, 'check: Uncaught error from main check');
    process.abort();
  } finally {
    checking = false;
  }
}

// Run the check immediately on start, then schedule the intervals
info('Running initial check');
await check();
info(
  'Completed initial check, starting re-check on cron string %s',
  notifyCron
);

cron.schedule(notifyCron, async () => check(Array.from(failures.keys())));
cron.schedule(reminderCron, async () => check());
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
  if (!request?.headers) {
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
    status.global.status,
    'Responding to request with current global status'
  );
  response.json(status);

  response.end();
});
// /trellis-monitor/trigger -> run check(), then return global status
app.get('/trigger', async (request, response) => {
  if (!request?.headers) {
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
    status.global.status,
    'trigger: Responding to request with current global status'
  );
  response.json(status);

  response.end();
});

// Proxy routes https://<domain>/trellis-monitor to us on 80
app.listen(port, () => {
  info('@trellisfw/monitor listening on port %d', port);
});

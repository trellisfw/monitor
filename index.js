const Promise = require('bluebird');
const _ = require('lodash'); // Lazy, lodash isn't really needed anymore);
const debug = require('debug');
const express = require('express');
const { connect } = require('@oada/client');
const uuid = require('uuid');
const moment = require('moment');
const cron = require('node-cron');

const testers = require('./testers');
const notifiers = require('./notifiers');

const config = require('./config.js');
const testasn = require('./testasn.js');

(async () => {
  const error = debug('trellis-monitor:error');
  const info = debug('trellis-monitor:info');
  //const warn = debug("trellis-monitor:warn");
  const trace = debug('trellis-monitor:trace');

  const incomingToken = config.get('incomingToken');
  const tokenToRequestAgainstOADA = config.get('tokenToRequestAgainstOADA');
  let domain = config.get('domain');
  if (!domain.match(/^http/)) domain = 'https://' + domain;
  const cronschedule = config.get('cron') || '* */15 * * * *';
  const notifyurl = config.get('notifyurl') || false;

  info('Starting monitor with cron = ', cronschedule);

  const oada = await connect({
    domain,
    token: tokenToRequestAgainstOADA,
    connection: 'http', // no need to keep open websockets
  }).catch((e) => {
    error('ERROR: failed to connect to OADA.  The error was: ', e);
  });
  trace(
    `Connected to oada, domain = ${domain}, token = ${tokenToRequestAgainstOADA}`
  );

  // Is well-known up w/ SSL?
  // Is bookmarks up w/ Boomi token?
  // Any jobs in Target queue w/ update longer than 30 mins ago?
  // asn-staging: if last _rev is more than 5 mins old, and we still have keys in asn-staging, error
  // asn-staging: if last _rev more than 12 hours old, error
  // asns/day-index: count the number of keys today for reporting
  // We will refrain from posting a dummy ASN for now, can use "postOne" if we want to.

  const status = {
    global: {
      status: 'failure',
    },
    tests: {},
  };

  let tests = {
    'well-known-ssl': {
      desc: 'Is well-known up with valid SSL?',
      type: 'pathTest',
      params: { path: `/.well-known/oada-configuration` },
    },

    'bookmarks': {
      desc: `Is bookmarks up for token ${tokenToRequestAgainstOADA.slice(
        0,
        1
      )}..${tokenToRequestAgainstOADA.slice(-2)}`,
      type: 'pathTest',
      params: { path: `/bookmarks` },
    },

    'stale-target-jobs': {
      desc: `Is target job queue devoid of stale (15-min) jobs?`,
      type: 'staleKsuidKeys',
      params: {
        path: `/bookmarks/services/target/jobs`,
        maxage: 15 * 6, // 15 mins
      },
    },

    'staging-clean': {
      desc: `Does asn-staging have any stale (5-min) ksuid keys?`,
      type: 'staleKsuidKeys',
      params: {
        path: `/bookmarks/trellisfw/asn-staging`,
        maxage: 5 * 60, // 5 mins
      },
    },

    'staging-inactive': {
      desc: `Is asn-staging's latest rev newer than 12 hours ago?`,
      type: 'revAge',
      params: {
        path: `/bookmarks/trellisfw/asn-staging`,
        maxage: 12 * 3600, // 12 hours
      },
    },

    'count-asns-today': {
      desc: `Count number of asn's received in today's day-index`,
      type: 'countKeys',
      params: {
        path: `/bookmarks/trellisfw/asns`,
        index: `day-index`, // tells it to count keys in this known typeof index instead of path
      },
    },
  };

  //-------------------------------------------------------
  // Trigger testing on a schedule:
  const check = async () => {
    try {
      trace(`Running tests`);
      const testkeys = _.keys(tests);
      const results = await Promise.map(
        testkeys,
        async (tk) => {
          trace(`Running test ${tk}`);
          try {
            const t = tests[tk];
            const runner = testers[t.type];
            if (!runner)
              return { status: 'failure', message: 'Invalid tester type' };
            return await runner({ ...t.params, oada });
          } catch (e) {
            info(`Test ${tk} threw uncaught exception: `, e);
            return {
              status: 'failure',
              message: `Uncaught exception: ${e.toString()}`,
            };
          }
        },
        { concurrency: 1 }
      );

      trace('Results of tests: ', results);
      status.tests = _.zipObject(testkeys, results);
      const failures = _.filter(
        results,
        (r) => !r.status || r.status !== 'success'
      );
      trace(`Results filtered to failures = `, failures);
      status.global.status = failures.length < 1 ? 'success' : 'failure';
      status.global.lastruntime = moment().format('YYYY-MM-DD HH:mm:ss');

      if (status.global.status === 'success') {
        info(`${moment().format('YYYY-MM-DD HH:mm:ss')}: Tests all successful`);
        return;
      }

      info(
        `Failure: sending notification.  Failure status is: `,
        JSON.stringify(status, null, '  ')
      );
      if (notifyurl) {
        trace(`Posting message to config.get('notifyurl') = ${notifyurl}`);
        try {
          notifiers.notifySlack(notifyurl, status);
        } catch (e) {
          error(`FAILED TO NOTIFY SLACK!  Error was: ${e.toString()}`);
        }
      }
    } catch (e) {
      error(
        `check: Uncaught error from main check.  Error was: ${e.toString()}`
      );
    }
  };
  // Run the check immediately on start, then schedule the intervals
  info(`Running initial check`);
  await check();
  info(
    `Completed initial check, starting re-check on cron string ${cronschedule}`
  );
  cron.schedule(cronschedule, check);
  info(`Started monitor`);

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
      `Responding to request with current global status ${status.global.status}`
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

    info(`trigger: triggering extra run of check() based on request`);
    await check();
    info(
      `trigger: Responding to request with current global status ${status.global.status}`
    );
    res.json(status);

    res.end();
  });

  // proxy routes https://<domain>/trellis-monitor to us on 80
  app.listen(config.get('port'), () =>
    console.log(`trellis-monitor listening on port ${config.get('port')}`)
  );
})();

async function postOne() {
  let newkey = false;
  const con = await oada.connect({
    domain,
    token: tokenToRequestAgainstOADA,
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
        data: testasn,
        headers: {
          'content-type': 'application/vnd.trellisfw.asn-staging.sf.1+json',
        },
      })
      .then((r) => r.headers['content-location'].slice(1))
      .catch((e) => {
        error('FAILED to post ASN to asn-staging!  error was: ', e);
        throw new Error(
          'FAILED to post ASN to asn-staging!  error was: ' +
            JSON.stringify(e, false, '  ')
        );
      });
    info('Document posted to asn-staging as new key', newkey);

    const p = new Promise(async (resolve, reject) => {
      try {
        // Set a timer to timeout when waiting
        setTimeout(() => {
          if (!p.isFulfilled()) {
            error(
              'TIMEOUT: took longer than ' +
                timeout +
                'ms to fulfill, returning error!'
            );
            reject('TIMEOUT: took longer than ' + timeout + 'ms to fulfill');
          }
        }, timeout);
        // Create watch handler
        function watchHandler(payload) {
          const change = payload && payload.response && payload.response.change;
          if (!change || change.type !== 'merge') {
            trace(
              'received change, but was not a merge.  change was: ',
              change
            );
            return;
          }
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
            return resolve(change.body[newkey]._rev);
          }
          trace('received change, but nothing matches "asset created"');
        }
        // Set a watch on asn's, look for this key to show up
        await con.get({
          path: '/bookmarks/trellisfw/asns',
          watch: { callback: watchHandler },
        });
      } catch (e) {
        error('FAILED waiting for success, never saw it');
        res.json({ error: true, message: JSON.stringify(e, false, '  ') });
        throw e;
      }
    });
    const success_rev = await p;
    info('Overall test successful on key ', newkey);
    currentlysuccess = true;
    latestmessage = `ASN push to IFT succeeded on id ${newkey} on rev ${success_rev}`;
  } catch (e) {
    error('FAILED waiting for success, never saw it');
    currentlysuccess = false;
    latestmessage = JSON.stringify(e, false, '  ');
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

module.exports = { postOne };

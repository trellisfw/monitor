import Promise from 'bluebird';
import _ from 'lodash'; // Lazy, lodash isn't really needed anymore
import debug from 'debug';
import express from 'express';
import fs from 'fs';
import oada from '@oada/oada-cache';
import uuid from 'uuid';
import moment from 'moment';

import config from './config.js'
import testasn from './testasn.js'

const error = debug('trellis-monitis:error');
const info = debug('trellis-monitis:info');
const warn = debug('trellis-monitis:warn');
const trace = debug('trellis-monitis:trace');

const app = express()
const port = 80; // proxy routes https://<domain>/monitis-monitor to us on 80

const incomingToken = config.get('incomingToken');
const tokenToRequestAgainstOADA = config.get('tokenToRequestAgainstOADA');
const timeout = config.get('timeout');
let domain = config.get('domain');
if (!domain.match(/^http/)) domain = 'https://'+domain;

trace('timeout = ', timeout);

app.get('/monitis-monitor', async (req, res) => {

  if (!req || !req.headers) {
    trace('no headers!');
    return res.end();
  }
  if (req.headers.authorization !== 'Bearer '+incomingToken) {
    trace('Not the right token');
    return res.end();
  }

  let newkey = false;
  const con = await oada.connect({domain,token:tokenToRequestAgainstOADA,cache:false});
  try {
    trace('Connected to OADA, retrieving current target job queue');
    const queue = await con.get({ path: '/bookmarks/services/target/jobs' }).then(r=>r.data);
    const validkeys = _.filter(_.keys(queue), k => !k.match(/^_/)); // remove any OADA keys like _id, _rev, _meta
    if (validkeys.length > 10) {
      error('Target job queue is longer than 10 items, not posting new ASN');
      throw new Error('Target job queue is longer than 10 items, not posting new ASN');
    }
    
    trace('Job queue sufficiently small (< 10), posting test ASN');

    const now = moment().utc().format('X');
    const rand = uuid.v4().replace(/-/g,'').slice(0,15);
    const newkey = `MONITIS-${now}-${rand}`;
    const stagingid = await con.put({
      path: `/bookmarks/trellisfw/asn-staging/${newkey}`,
      data: testasn,
      headers: { 'content-type': 'application/vnd.trellisfw.asn-staging.sf.1+json' }
    }).then(r=>r.headers['content-location'].slice(1))
    .catch(e => {
      error('FAILED to post ASN to asn-staging!  error was: ', e);
      throw new Error('FAILED to post ASN to asn-staging!  error was: '+JSON.stringify(e,false,'  '));
    });
    info('Document posted to asn-staging as new key',newkey);

    const p = new Promise(async (resolve,reject) => {
      try {
        // Set a timer to timeout when waiting
        setTimeout(() => {
          if (!p.isFulfilled()) {
            error('TIMEOUT: took longer than '+timeout+'ms to fulfill, returning error!');
            reject('TIMEOUT: took longer than '+timeout+'ms to fulfill');
          }
        }, timeout);
        // Create watch handler
        function watchHandler(payload) {
          const change = payload && payload.response && payload.response.change;
          if (!change || change.type !== 'merge') {
            trace('received change, but was not a merge.  change was: ', change);
            return;
          }
          if (!change.body[newkey]) {
            trace('received change, but was not to the new key.  change was: ', change);
            return;
          }
          trace(`Received change on ${newkey}, will check if it is meta as "asset created"`);
          const meta = change.body[newkey]._meta;
          trace('change meta = ', meta);
          if (!meta) {
            trace('received change, and to the right key, but not to meta');
            return;
          }
          const target = meta.services && meta.services.target && meta.services.target.tasks;
          if (!target) {
            trace('received change, and to the right key w/ meta, but not to meta.services.target.tasks');
            return;
          }
          // JSON.stringify to make looking through all tasks much simpler
          const str = JSON.stringify(target);
          if (str.match(/asset[ _-]+created/i)) {
            trace('received change, asset is created, resolving promise');
            return resolve(change._rev);
          }
          trace('received change, but nothing matches "asset created"');
        }
        // Set a watch on asn's, look for this key to show up
        await con.get({
          path: '/bookmarks/trellisfw/asns',
          watch: { callback: watchHandler }
        });
      } catch(e) {
        error('FAILED waiting for success, never saw it');
        res.json({ error: true, message: JSON.stringify(e,false,'  ') });
        throw e;
      }
    });
    const success_rev = await p;
    info('Overall test successful on key ',newkey);
    res.json({ success: true, message: `ASN push to IFT succeeded on id ${newkey} on rev ${success_rev}` });
  } catch(e) {
    error('FAILED waiting for success, never saw it');
    res.json({ error: true, message: JSON.stringify(e,false,'  ') });
  } finally {
    // Delete the asn-staging entry, the asns entry, and the resource itself
    if (newkey) {
      warn('You have commented all the deletes, so all monitor-generated ASN resources will stay there.')
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
    res.end();
    con.disconnect();
    trace('DONE!');
  }
  
});

app.listen(port, () => console.log(`Monitis monitor listening on port ${port}`))

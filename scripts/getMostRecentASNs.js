(async function() {
const _ = require('lodash');
const oada = require('@oada/oada-cache');
const Promise = require('bluebird');
const moment = require('moment');
const argv = require('minimist')(process.argv.slice(2));

let domain = argv.d || process.env.DOMAIN || 'localhost';
if (!domain.match(/^http/)) domain = 'https://'+domain;
const token = argv.t || process.env.TOKEN || 'def';

const con = await oada.connect({
  token, domain,
  cache: false,
  websocket: false,
});

let res = await con.get({ path: '/bookmarks/trellisfw/asns' });
let asns = res.data;

let asnkeys = _.filter(_.keys(asns), k => !k.match(/MONITIS/));
asnkeys = _.filter(asnkeys, k => !k.match(/^_/));

console.log('Getting '+asnkeys.length+' ASNs');
let metas = await Promise.map(asnkeys, async (key) => {
  try {
    console.log('Getting /bookmarks/trellisfw/asns/'+key+'/_meta');
    const res = await con.get({ path: '/bookmarks/trellisfw/asns/'+key+'/_meta' })
    const meta = res.data;
    meta.key = key;
    return meta;
  } catch(e) {
    return { key: 'ERROR: '+key, modified: new Date() };
  }
}, { concurrency: 1 });

console.log('Have the metas, here are the keys and dates');

metas = _.sortBy(metas, m => m.modified);

_.each(metas, m => {
  const day = moment(m.modified, 'X').format('YYYY-MM-DD HH:mm:ss');
  console.log(`${m.key}: ${day}`);
});

})();


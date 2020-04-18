const oada = require('@oada/oada-cache');
const _ = require('lodash');
const Promise = require('bluebird');
const argv = require('minimist')(process.argv.slice(2));

(async () => {

let domain = argv.d || process.env.DOMAIN || 'https://localhost';
if (!domain.match(/^http/)) domain = 'https://'+domain;
const token = argv.t || process.env.TOKEN || 'localhost';
const listpath = argv.p || process.env.LISTPATH || '/bookmarks/services/target/jobs';

const con = await oada.connect({ domain, token, cache: false, websocket: false });

console.log('Retrieving path '+listpath+' to search for MONITIS keys');
const list = await con.get({ path: listpath }).then(r=>r.data);
console.log('Retrieved initial list resource: ', list);
const monitiskeys = _.filter(_.keys(list), k => k.match(/MONITIS/));
console.log('Filtered keys to only MONITIS = ', monitiskeys);

await Promise.map(monitiskeys, async k => {
  const path = listpath + '/' + k;
  console.log('Deleting path: '+path);
  await con.delete({ path, headers: { 'content-type': 'application/vnd.trellisfw.asn.sf.1+json' } });
  console.log('Deleted path '+path);
}, { concurrency: 3 });

console.log('Deletion complete');


})();


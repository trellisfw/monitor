/**
 * @license
 * Copyright 2021 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint-disable no-console */

import minimist from 'minimist';
import moment from 'moment';
import oada from '@oada/oada-cache';

const argv = minimist(process.argv.slice(2));

let domain = argv.d || process.env.DOMAIN || 'localhost';
if (!domain.startsWith('http')) domain = `https://${domain}`;
const token = argv.t || process.env.TOKEN || 'def';

const con = await oada.connect({
  token,
  domain,
  cache: false,
  websocket: false,
});

const { data: asns } = await con.get({ path: '/bookmarks/trellisfw/asns' });

const asnkeys = Object.keys(asns).filter(
  (k) => !(/MONITIS/.test(k) || !k.startsWith('_'))
);

console.log(`Getting ${asnkeys.length} ASNs`);
const metas = [];
for (const key of asnkeys) {
  try {
    console.log(`Getting /bookmarks/trellisfw/asns/${key}/_meta`);
    // eslint-disable-next-line no-await-in-loop
    const { data: meta } = await con.get({
      path: `/bookmarks/trellisfw/asns/${key}/_meta`,
    });
    meta.key = key;
    metas.push(meta);
  } catch {
    metas.push({ key: `ERROR: ${key}`, modified: new Date() });
  }
}

console.log('Have the metas, here are the keys and dates');

for (const meta of metas.sort((m) => m.modified)) {
  const day = moment(meta.modified, 'X').format('YYYY-MM-DD HH:mm:ss');
  console.log(`${meta.key}: ${day}`);
}

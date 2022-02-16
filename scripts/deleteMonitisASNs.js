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

import { connect } from '@oada/client';

const argv = minimist(process.argv.slice(2));

let domain = argv.d || process.env.DOMAIN || 'https://localhost';
if (!domain.startsWith('http')) {
  domain = `https://${domain}`;
}

const token = argv.t || process.env.TOKEN || 'localhost';
const listpath =
  argv.p || process.env.LISTPATH || '/bookmarks/services/target/jobs';

const con = await connect({
  domain,
  token,
  cache: false,
  websocket: false,
});

console.log(`Retrieving path ${listpath} to search for MONITIS keys`);
const { data: list } = await con.get({ path: listpath });
console.log('Retrieved initial list resource:', list);
const monitisKeys = Object.keys(list).filter((k) => k.match(/MONITIS/));
console.log('Filtered keys to only MONITIS =', monitisKeys);

await Promise.all(
  monitisKeys.map(async (k) => {
    const path = `${listpath}/${k}`;
    console.log(`Deleting path: ${path}`);
    await con.delete({
      path,
      headers: { 'content-type': 'application/vnd.trellisfw.asn.sf.1+json' },
    });
    console.log(`Deleted path ${path}`);
  })
);

console.log('Deletion complete');

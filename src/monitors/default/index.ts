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

/**
 * @packageDocumentation
 *
 * This module is the default set of monitoring tests
 */

import type { Test } from '../../';

export const well_known_ssl: Test = {
  desc: 'Is well-known up with valid SSL?',
  type: 'pathTest',
  params: { path: `/.well-known/oada-configuration` },
};

export const bookmarks: Test = {
  desc: 'Is bookmarks up for our token?',
  type: 'pathTest',
  params: { path: `/bookmarks` },
};

export const stale_target_jobs: Test = {
  desc: 'Is target job queue devoid of stale (15-min) jobs?',
  type: 'staleKsuidKeys',
  params: {
    path: `/bookmarks/services/target/jobs`,
    maxage: 15 * 6, // 15 mins
  },
};

export const staging_clean: Test = {
  desc: 'Does asn-staging have any stale (5-min) ksuid keys?',
  type: 'staleKsuidKeys',
  params: {
    path: `/bookmarks/trellisfw/asn-staging`,
    maxage: 5 * 60, // 5 mins
  },
};

export const staging_inactive: Test = {
  desc: "Is asn-staging's latest rev newer than 12 hours ago?",
  type: 'revAge',
  params: {
    path: `/bookmarks/trellisfw/asn-staging`,
    maxage: 12 * 3600, // 12 hours
  },
};

export const count_asns_today: Test = {
  desc: "Count number of ASNs received in today's day-index",
  type: 'countKeys',
  params: {
    path: `/bookmarks/trellisfw/asns`,
    index: `day-index`, // tells it to count keys in this known typeof index instead of path
  },
};

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

/* eslint-disable camelcase */

export const stale_target_jobs = {
  desc: 'Is target job queue devoid of stale (15-min) jobs?',
  type: 'staleKsuidKeys',
  params: {
    path: '/bookmarks/services/target/jobs',
    maxage: 15 * 1000 * 60, // 15 mins
  },
};

export const staging_clean = {
  desc: 'Does asn-staging have any stale (5-min) ksuid keys?',
  type: 'staleKsuidKeys',
  params: {
    path: '/bookmarks/trellisfw/asn-staging',
    maxage: 5 * 1000 * 60, // 5 mins
  },
};

export const jobs_current = {
  desc: 'Is the last modified on the target job queue within 15 mins of asns list?',
  type: 'relativeAge',
  params: {
    leader: '/bookmarks/trellisfw/asns',
    follower: '/bookmarks/services/target/jobs',
    maxage: 15 * 1000 * 60,
  },
};

export const count_asns_today = {
  desc: "Count number of ASNs received in today's day-index",
  type: 'countKeys',
  params: {
    path: '/bookmarks/trellisfw/asns',
    index: 'day-index', // Tells it to count keys in this known typeof index instead of path
  },
};

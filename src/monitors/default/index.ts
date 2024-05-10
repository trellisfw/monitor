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

/**
 * @packageDocumentation
 *
 * This module is the default set of monitoring tests
 */

/* eslint-disable @typescript-eslint/naming-convention */

import type { Test } from '../../index.js';

export const well_known_ssl: Test = {
  desc: 'Is well-known up with valid SSL?',
  type: 'pathTest',
  params: { path: '/.well-known/oada-configuration' },
};

export const bookmarks: Test = {
  desc: 'Is bookmarks up for our token?',
  type: 'pathTest',
  params: { path: '/bookmarks' },
};

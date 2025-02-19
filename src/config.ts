/**
 * @license
 *  Copyright 2020 Qlever LLC
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

// eslint-disable-next-line unicorn/import-style
import { dirname, join } from 'node:path';
import url from 'node:url';

import load from '@oada/lib-config';

const { config } = await load({
  oada: {
    domain: {
      doc: 'OADA API domain',
      format: String,
      default: 'localhost',
      env: 'DOMAIN',
    },
    token: {
      doc: 'OADA API token',
      format: String,
      default: 'god',
      sensitive: true,
      env: 'TOKEN',
    },
  },
  server: {
    token: {
      doc: 'Token expected on incoming requests',
      format: String,
      default: 'god',
      sensitive: true,
      // TODO: fix capitalization
      env: 'incomingToken',
    },
    port: {
      doc: 'port to listen on',
      format: 'port',
      default: 8080,
      env: 'PORT',
      arg: 'port',
    },
  },
  notify: {
    name: {
      doc: 'Who to say we are when notifying. Defaults to oada.domain',
      format: String,
      default: '',
      env: 'NAME',
    },
    url: {
      doc: 'URL to which to POST notifications',
      format: String,
      default: '',
      // TODO: fix capitalization
      env: 'notifyurl',
    },
    cron: {
      doc: 'Cron format of when to notify of _new_ issues',
      format: String,
      // Every 15 minutes
      default: '*/15 * * * *',
      env: 'CRON',
    },
    reminderCron: {
      doc: 'Cron format of when to notify of all existing issues',
      format: String,
      // Remind once a day at midnight?
      default: '0 0 * * *',
      env: 'REMINDER_CRON',
    },
  },
  // TODO: IDK what this is
  timeout: {
    format: Number,
    // 10 minutes
    default: 10 * 60 * 1000,
  },
  tests: {
    dir: {
      doc: 'directory of "test modules" to load',
      format: String,
      default: join(dirname(url.fileURLToPath(import.meta.url)), './monitors'),
      env: 'TESTS_DIR',
    },
    enabled: {
      doc: 'Comma separated list of patterns of test names to run',
      format: String,
      default: '*',
      env: 'TESTS',
    },
  },
});

export default config;

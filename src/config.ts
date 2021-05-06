/* Copyright 2020 Qlever LLC
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

import { join } from 'path';

import convict from 'convict';
import { config as load } from 'dotenv';

load();

const config = convict({
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
      env: 'TOKEN',
    },
  },
  server: {
    token: {
      doc: 'Token expected on incoming requests',
      format: String,
      default: 'god',
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
    },
    url: {
      doc: 'URL to which to POST notifications',
      format: String,
      default: '',
      // TODO: fix capitalization
      env: 'notifyurl',
    },
    cron: {
      doc: 'Cron format of when to notify',
      format: String,
      // Every 15 minutes
      default: '*/15 * * * *',
      env: 'CRON',
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
      default: join(__dirname, './monitors'),
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

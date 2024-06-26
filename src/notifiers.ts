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

import debug from 'debug';
import moment from 'moment';
import tiny from 'tiny-json-http';

const info = debug('trellis-monitor:info');
const error = debug('trellis-monitor:error');

export const notifySlack = async (notifyurl: string, status: unknown) => {
  const message = {
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*trellis-monitor detected failure*',
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        block_id: 'section567',
        text: {
          type: 'mrkdwn',
          text: moment().format('YYYY-MM-DD HH:mm:ss'),
        },
      },
    ],
    attachments: [
      {
        blocks: [
          // Doing the code in an "attachment" makes it "secondary" and therefore collapsed by default
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `\`\`\`${JSON.stringify(status, undefined, '  ')}\`\`\``,
            },
          },
        ],
      },
    ],
  };

  try {
    await tiny.post({
      url: notifyurl,
      data: message,
      headers: { 'content-type': 'application/json' },
    });
    info('notifySlack: Successfully posted status to slack');
  } catch (cError: unknown) {
    error(cError, 'finishReporters#slack: failed to post message to slack!');
  }
};

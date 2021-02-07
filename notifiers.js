const tiny = require('tiny-json-http');
const moment = require('moment');

const debug  = require('debug');
const info = debug('trellis-monitor:info');
const error = debug('trellis-monitor:error');

const notifySlack = async (notifyurl, status) => {
  const message = {
    "blocks": [
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": `*trellis-monitor detected failure*`,
        }
      },
      {
        "type": "divider"
      },
      {
        "type": "section",
        "block_id": "section567",
        "text": {
          "type": "mrkdwn",
          "text": moment().format('YYYY-MM-DD HH:mm:ss'),
        }
      }
    ]  ,
    "attachments": [
      {
        "blocks": [ // doing the code in an "attachement" makes it "secondary" and therefore collapsed by default
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": `\`\`\`${JSON.stringify(status, null, '  ')}\`\`\``,
            }
          }
        ]
      }
    ]
  };

  await tiny.post({ url: notifyurl, data: message, headers: { 'content-type': 'application/json' } })
  .then(() => info('notifySlack: Successfully posted status to slack'))
  .catch(e => {
    error('finishReporters#slack: ERROR: failed to post message to slack!  Error was: ', e);
  });
  
}

module.exports = { notifySlack };

const _ = require('lodash');
const ksuid = require('ksuid');
const moment = require('moment');
const debug = require('debug');

const trace = debug('trellis-monitor:trace');


const pathTest = async ({path,oada}) => {
  try {
    trace(`pathTest: GET ${path}`);
    await oada.get({path});
    return { status: 'success' }; // if it doesn't throw, we're good
  } catch(e) {
    trace(`pathTest: failed to get path, error = `, e);
    return { 
      status: 'failure', 
      message: `Failed to retrieve path ${path}: ${strError(e)}`
    };
  }
}


const revAge = async ({ path, maxage, oada}) => {
  try {
    trace(`revAge: testing rev at ${path} against maxage ${maxage}`);
    const lastrev = await oada.get({path: `${path}/_rev`}).then(r=>r.data);
    const changes = await oada.get({path: `${path}/_meta/_changes/${lastrev}`}).then(r=>r.data);
    // Get the change to ""  (i.e. this node)
    const change = _.find(changes, c => c.path === '');
    const modified = moment(_.get(change, `body._meta.modified`, 0)*1000);
    trace(`revAge: lastrev = ${lastrev}, modified = ${modified.valueOf()}, difference = ${moment().valueOf() - modified.valueOf()}`);
    if (moment().valueOf() - modified.valueOf() > maxage*1000) {
      return { 
        status: 'failure', 
        message: `Age of latest rev (${_.get(change, 'body._rev')}) is ${modified.format('YYYY-MM-DD HH:mm:ss')}, older than ${maxage/3600} hours` 
      };
    }
    return { status: 'success' };
  } catch(e) {
    return { 
      status: 'failure', 
      message: `Failed in retrieving age of latest rev.  Error was: ${strError(e)}`,
    };
  }
};


const staleKsuidKeys = async ({ path, maxage, oada }) => {
  try {
    trace(`staleKsuidKeys: testing ${path} against maxage ${maxage}`);
    const list = await oada.get({path}).then(r=>r.data);
    const keys = _.filter(_.keys(list), k => !k.match(/^_/));
    if (keys.length < 0) return { status: "success" };
    // Otherwise, check the timestamps of all the job key ksuid's
    const ksuids = _.map(keys, ksuid.parse);
    trace(`staleKsuidKeys: checking ksuid keys: `, keys);
    const now = moment().valueOf();
    const errors = _.filter(ksuids, t => {
      trace(`staleKsuidKeys: now ${now} - ksuid date ${t.date.valueOf()} = ${now - t.date.valueOf()}`);
      return (now - t.date.valueOf()) > (maxage * 1000);
    });
    if (errors.length > 0) {
      return { 
        status: 'failure', 
        message: `Had ${errors.length} ksuid keys beyond maxage of ${maxage}: ${JSON.stringify(_.map(errors, e => e.string))}`,
      };
    }
    return { status: "success" };
  } catch(e) {
    trace(`staleKsuidKeys: Error thrown from somewhere, e = `, e);
    return { 
      status: 'failure', 
      message: `Failed to retrieve list of keys from path ${path}.  Error was: ${strError(e)}` 
    };
  }
};


const countKeys = async ({ path, index=null, oada }) => {
  try {
    if (index) {
      switch(index) {
        case 'day-index': 
          path = `${path}/day-index/${moment().format('YYYY-MM-DD')}`; 
        break;
        default: 
          return { status: "failure", message: `Unknown type of index passed ${index}` };
      }
    }
    const res = await oada.get({path}).then(r=>r.data)
    const keys = _.filter(_.keys(res), k => !k.match(/^_/));
    return {
      status: 'success',
      count: keys.length,
    };
  } catch(e) { 
    if (e.status && e.status === 404) {
      // today doesn't have an index
      return { status: 'success', count: 0 };
    }
    return { 
      status: 'failure', 
      message: `Failed to count keys from path ${path}.  Error was: ${strError(e)}` 
    };
  }
}

function strError(e) {
  if (!e) return JSON.stringify(e);
  if (e.message) return e.message;
  // The http response objects do not have the things you want to know as enumerable properties:
  if (e.status) {
    return `{ url: ${e.url}, status: ${e.status}, statusText: ${e.statusText} }`;
  }
  return JSON.stringify(e, null, '  ');
}

module.exports= {
  pathTest,
  revAge,
  staleKsuidKeys,
  countKeys,
};

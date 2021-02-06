const { expect } = require('chai');
const { connect } = require('@oada/client');
const ksuid = require('ksuid');
const { pathTest, revAge, staleKsuidKeys } = require('../testers');
const Promise = require('bluebird');
const tiny = require('tiny-json-http');

const config = require('../config');
const interval = config.get('interval');

const tree = {
  bookmarks: {
    _type: 'application/vnd.oada.bookmarks.1+json',
    trellisfw: {
      _type: 'application/vnd.trellisfw.1+json',
      asns: {
        _type: 'application/vnd.trellisfw.asns.1+json',
      },
      'asn-staging': {
        _type: 'application/vnd.trellisfw.asn-staging.1+json',
      },
    },
    services: {
      _type: 'application/vnd.oada.services.1+json',
      target: {
        _type: 'application/vnd.oada.service.1+json',
        jobs: {
          _type: 'applicaiton/vnd.oada.service.jobs.1+json',
        }
      }
    }
  }
}

// In watch mode, these tests need to wait for service to restart.  package.json adds `--delay` to 
// mocha in this case: it will wait to run our tests until we call "run".  Code for that is at bottom.
(async () => {

  describe('service', () => {
  
    let oada = false;
    before(async () => {
      oada = await connect({ domain: 'localhost', token: 'proxy' });
      // Setup the trees that it is expecting to be there
      await ensurePath(`/bookmarks/trellisfw/asn-staging`, oada);
      await ensurePath(`/bookmarks/trellisfw/asns`, oada);
      await ensurePath(`/bookmarks/services/target/jobs`, oada);
    });

    it('should fail on check after posting stale asn-staging ksuid key', async () => {
      const oldksuid = ksuid.randomSync(new Date('2021-02-03T01:00:00Z'))
      await oada.put({ 
        path: `/bookmarks/trellisfw/asn-staging`, 
        data: { [oldksuid]: { istest: true } },
        _type: 'application/json',
      });
      const res = await tiny.get({ url: `http://localhost:${config.get('port')}/trigger` });
      const status = _.get(res.body, 'tests.staging-clean');
      expect(status).to.deep.equal({ status: 'success' });
    });
   
  });

  if (run) {
    console.log('--delay passed, waiting 2 seconds before starting service tests');
    await Promise.delay(2000);
    console.log('Done waiting, starting service tests');
    run();
  }

})();

async function ensurePath(path, oada) {
  await oada.head({path}).catch(async e => {
    if (e.status === 404) {
      console.log('ensurePath: path '+path+' did not exist before test, creating');
      await oada.put({path, tree, data: {} });
      return;
    }
    console.log('ERROR: ensurePath: HEAD to path '+path+' returned non-404 error status: ', e);
  });
}


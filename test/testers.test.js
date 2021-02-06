const { expect } = require('chai');
const { connect } = require('@oada/client');
const ksuid = require('ksuid');
const config = require('../config');
const Promise = require('bluebird');
const moment = require('moment');
const { pathTest, revAge, staleKsuidKeys, countKeys } = require('../testers');

const domain = config.get('domain');
const token = config.get('tokenToRequestAgainstOADA');

describe('testers', () => {

  let oada = false;
  before(async () => {
    oada = await connect({ domain, token, connection: 'http' });
  });

  describe('#pathTest', () => {
    it('should have status: success for well-known', async () => {
      const result = await pathTest({path: '/.well-known/oada-configuration', oada});
      expect(result).to.deep.equal({ status: 'success' });     
    });

    it('should have status: success for bookmarks', async () => {
      const result = await pathTest({path: '/bookmarks', oada});
      expect(result.status).to.equal('success');
    });

    it('should have status: failure for nonexistent resource', async () => {
      const result = await pathTest({path: '/resources/idonotexist57993', oada});
      expect(result.status).to.equal('failure');
    });
  });

  describe('#revAge', () => {
    const path = '/resources/TRELLIS-MONITOR-TEST-'+ksuid.randomSync().string;

    before(async () => {
      await oada.put({ path, data: {}, _type: 'application/json' });
      await Promise.delay(1001); // wait 1 s should be sufficient to test age
    });

    after(async () => {
      await oada.delete({ path });
    });

    it('should have status: success for recently-created resource', async () => {
      const result = await revAge({path, maxage: 15, oada});
      expect(result.status).to.equal('success');
    });

    it('should have status: failure for old resource with short maxage', async () => {
      const result = await revAge({path, maxage: 1, oada});
      expect(result.status).to.equal('failure');
    });

  });

  describe('#staleKsuidKeys', () => {
    const path = '/resources/TRELLIS-MONITOR-TEST-'+ksuid.randomSync().string;
    const newksuid = ksuid.randomSync().string;
    const oldksuid = ksuid.randomSync(new Date('2021-02-03T01:00:00Z')).string;
    before(async () => {
      await oada.put({ path, data: {}, _type: 'application/json' });
      await Promise.delay(1001); // wait 1 s should be sufficient to test age
    });

    after(async () => oada.delete({ path }));

    it('should have status: success for resource w/ recent ksuid key', async () => {
      await oada.put({path, data: { [newksuid]: true }, _type: 'application/json' });
      const result = await staleKsuidKeys({ path, maxage: 60, oada });
      await oada.delete({path: `${path}/newksuid`});
      expect(result).to.deep.equal({ status: 'success' });
    });

    it('should have status: failure for resource w/ old ksuid key', async () => {
      await oada.put({path, data: { [oldksuid]: true }, _type: 'application/json' });
      const result = await staleKsuidKeys({ path, maxage: 1, oada });
      await oada.delete({path: `${path}/oldksuid`});
      expect(result.status).to.equal('failure');
    });

  });

  describe('#countKeys', () => {
    const parentid = 'resources/TRELLIS-MONITOR-TEST-'+ksuid.randomSync().string;
    const indexid = 'resources/TRELLIS-MONITOR-TEST-'+ksuid.randomSync().string;

    before(async () => {
      await oada.put({ path: `/${indexid}`, data: { key1: "val1", key2: "val2" }, _type: 'application/json' });
      await oada.put({ path: `/${parentid}`, 
        data: { 
          'day-index': {
            [moment().format('YYYY-MM-DD')]: { _id: indexid, _rev: 0 },
          }, 
        }, 
        _type: 'application/json' 
      });
    });
    after(async () => {
      await oada.delete({ path: `/${parentid}` });
      await oada.delete({ path: `/${indexid}` });
    });

    it('should have status: success and count=2 for resource w/ 2 keys', async () => {
      const result = await countKeys({ path: `/${parentid}`, index: 'day-index', oada });
      expect(result.status).to.equal('success');
      expect(result.count).to.equal(2);
    });

   
  });
  
});

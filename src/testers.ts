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
import ksuid from 'ksuid';
import moment from 'moment';

import type { OADAClient } from '@oada/client';

export interface TestResult {
  [key: string]: unknown;
  status: 'success' | 'failure';
  message?: string | undefined;
  desc?: string | undefined;
}

const trace = debug('trellis-monitor:trace');

const fmt = 'YYYY-MM-DD HH:mm:ss.SSS';

const pathTest = async ({
  path,
  oada,
}: {
  path: string;
  oada: OADAClient;
}): Promise<TestResult> => {
  try {
    trace('pathTest: GET %s', path);
    await oada.get({ path });
    return { status: 'success' }; // If it doesn't throw, we're good
  } catch (error: unknown) {
    trace(error, 'pathTest: failed to get path');
    return {
      status: 'failure',
      message: `Failed to retrieve path ${path}: ${stringError(error)}`,
    };
  }
};

const maxAge = async ({
  path,
  maxage,
  oada,
}: {
  path: string;
  oada: OADAClient;
  maxage: number;
}): Promise<TestResult> => {
  try {
    trace(`maxAge: testing rev at ${path} against maxage ${maxage}`);
    const { data } = await oada.get({ path: `${path}/_meta/modified` });
    const modified = Number(data) * 1000; // OADA has seconds w/ fractional msec
    const now = Date.now();
    const age = now - modified;
    trace(
      'maxAge: modified = %d msec, now = %d, difference = %d',
      modified,
      now,
      age
    );
    if (age > maxage) {
      return {
        status: 'failure',
        message: `Age of path ${path} at modified time ${moment(
          modified
        ).format(fmt)} has age ${age} which is older than maxage ${maxage}`,
      };
    }

    return { status: 'success' };
  } catch (error: unknown) {
    return {
      status: 'failure',
      message: `Failed in retrieving age of path ${path}.  Error was: ${stringError(
        error
      )}`,
    };
  }
};

const relativeAge = async ({
  leader,
  follower,
  maxage,
  oada,
}: {
  leader: string;
  follower: string;
  oada: OADAClient;
  maxage: number;
}): Promise<TestResult> => {
  try {
    trace(
      'relativeAge: testing age of leader %s vs. follower %s against maxage %d',
      leader,
      follower,
      maxage
    );
    const { data: leaderData } = await oada.get({
      path: `${leader}/_meta/modified`,
    });
    const leadermodified = Number(leaderData) * 1000;
    const { data: followerData } = await oada.get({
      path: `${follower}/_meta/modified`,
    });
    const followermodified = Number(followerData) * 1000;
    const now = Date.now();

    // Give the follower a grade period of maxage to figure out what to do before we would
    // consider it an error
    const leaderage = now - leadermodified;
    const relativeage = followermodified - leadermodified;

    trace(
      'relativeAge: leadermodified = %d, followermodified = %d, now = %d, now - leader  = %d',
      leadermodified,
      followermodified,
      now,
      leaderage
    );
    if (leaderage > maxage && relativeage < 0) {
      // Leader has waited long enough for follower, but follower is still behind
      return {
        status: 'failure',
        message: `Waited ${leaderage} msec (maxage ${maxage}) since leader was modified (${leadermodified}), but follower still has not updated (last modified ${followermodified})`,
      };
    }

    return { status: 'success' };
  } catch (error: unknown) {
    return {
      status: 'failure',
      message: `Failed in retrieving age of leader or follower.  Error was: ${stringError(
        error
      )}`,
    };
  }
};

const staleKsuidKeys = async ({
  path,
  maxage,
  oada,
}: {
  path: string;
  maxage: number;
  oada: OADAClient;
}): Promise<TestResult> => {
  try {
    trace('staleKsuidKeys: testing %s against maxage %d', path, maxAge);
    const { data: list } = await oada.get({ path });
    const keys = Object.keys(list as Record<string, unknown>).filter(
      (k) => !k.startsWith('_')
    );
    if (keys.length <= 0) {
      return { status: 'success' };
    }

    // Otherwise, check the timestamps of all the job key ksuid's
    const ksuids = keys.map((key) => ksuid.parse(key));
    trace('staleKsuidKeys: checking ksuid keys: %s', keys);
    const now = moment().valueOf();
    const errors = ksuids.filter((t) => {
      trace(
        'staleKsuidKeys: now %d - ksuid date %d = %d',
        now,
        t.date.valueOf(),
        now - t.date.valueOf()
      );
      return now - t.date.valueOf() > maxage * 1000;
    });
    if (errors.length > 0) {
      return {
        status: 'failure',
        message: `Had ${
          errors.length
        } ksuid keys beyond maxage of ${maxage}: ${JSON.stringify(
          errors.map((error) => error.string)
        )}`,
      };
    }

    return { status: 'success' };
  } catch (error: unknown) {
    trace(error, 'staleKsuidKeys: Error thrown from somewhere');
    return {
      status: 'failure',
      message: `Failed to retrieve list of keys from path ${path}.  Error was: ${stringError(
        error
      )}`,
    };
  }
};

const countKeys = async ({
  path,
  index = '',
  oada,
}: {
  path: string;
  index: string;
  oada: OADAClient;
}): Promise<TestResult> => {
  try {
    if (index) {
      // eslint-disable-next-line sonarjs/no-small-switch
      switch (index) {
        case 'day-index':
          path = `${path}/day-index/${moment().format('YYYY-MM-DD')}`;
          break;
        default:
          return {
            status: 'failure',
            message: `Unknown type of index passed ${index}`,
          };
      }
    }

    const { data: response } = await oada.get({ path });
    const keys = Object.keys(response as Record<string, unknown>).filter(
      (k) => !k.startsWith('_')
    );
    return {
      status: 'success',
      count: keys.length,
    };
  } catch (error: unknown) {
    // @ts-expect-error stuff
    if (error?.status === 404) {
      // Today doesn't have an index
      return { status: 'success', count: 0 };
    }

    return {
      status: 'failure',
      message: `Failed to count keys from path ${path}.  Error was: ${stringError(
        error
      )}`,
    };
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stringError(error: any) {
  if (!error) {
    return JSON.stringify(error);
  }

  if (error.message) {
    return error.message as string;
  }

  // The http response objects do not have the things you want to know as enumerable properties:
  if (error.status) {
    return `{ url: ${error.url}, status: ${error.status}, statusText: ${error.statusText} }`;
  }

  return JSON.stringify(error, undefined, '  ');
}

export { pathTest, maxAge, relativeAge, staleKsuidKeys, countKeys };

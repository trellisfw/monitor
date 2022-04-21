# trellisfw/monitor

[![License](https://img.shields.io/github/license/trellisfw/monitor)](LICENSE)
[![Docker Pulls](https://img.shields.io/docker/pulls/trellisfw/monitor)][dockerhub]

This service can monitor an OADA/Trellis installation on a schedule and alert if something fails.
The schedule looks like a regular cron-style string: `*/15 * * * *` means "every 15 minutes".
`minute hour day_of_month month day_of_week`

There are a set of available "tests" you can run:

- _maxAge_: alert if a given resource is older than maxAge
- _relativeAge_: alert if a "follower" resource is older than maxAge from a "leader" resource
- _pathTest_: alert if the path does not exist or otherwise returns non-2xx code
- _staleKsuidKeys_: alert if a resource contains any KSUID keys whose timestamp is older than maxAge

There is a set of default tests in monitors/default. You can add additional files
to `dist/monitors` and they will be included in the tests run on the cron schedule.
There are example configs in `examples/`.

If any test fails, alerts are sent to the environment-specified `notifyurl`. The output
is a JSON object containing the status of every test that was run during this interval.

You can also poll the monitor for its latest results at port 8080 of the service, or if included
in an OADA deployment at `<domain>/trellis-monitor`. You can trigger a run of the tests
at `/trellis-monitor/trigger`.

## Important Configuration

The token required to retrieve the current monitor status from outside is passed
as an environment variable:

```sh
incomingToken="02ioj3flkfs" yarn run start
```

(see additional usage below for local docker or OADA deployment)

Also, because of nuances w/ modules, you cannot have a test named "default".

## Example set of monitor

```javascript
module.exports = {
  stale_email_jobs: {
    desc: 'Is email job queue devoid of stale (15-min) jobs?',
    type: 'staleKsuidKeys',
    params: {
      path: `/bookmarks/services/email/jobs`,
      maxage: 15 * 1000 * 60, // 15 mins
    },
  },

  staging_clean: {
    desc: 'Does asn-staging have any stale (5-min) ksuid keys?',
    type: 'staleKsuidKeys',
    params: {
      path: `/bookmarks/trellisfw/asn-staging`,
      maxage: 5 * 1000 * 60, // 5 mins
    },
  },

  staging_inactive: {
    desc: "Is asn-staging's latest rev newer than 12 hours ago?",
    type: 'maxAge',
    params: {
      path: `/bookmarks/trellisfw/asn-staging`,
      maxage: 12 * 1000 * 3600, // 12 hours
    },
  },

  jobs_current: {
    desc: 'Is the last modified on the email job queue within 15 mins of asns list?',
    type: 'relativeAge',
    params: {
      leader: `/bookmarks/trellisfw/asns`,
      follower: `/bookmarks/services/email/jobs`,
      maxage: 15 * 1000 * 60,
    },
  },

  count_asns_today: {
    desc: "Count number of ASNs received in today's day-index",
    type: 'countKeys',
    params: {
      path: `/bookmarks/trellisfw/asns`,
      index: `day-index`, // tells it to count keys in this known typeof index instead of path
    },
  },
};
```

## Usage

To run locally:

```sh
yarn run start
```

To run locally in docker:

```sh
docker-compose up -d
```

To run as part of an OADA deployment, just grab the `docker-compose.oada.yml` and
`support` from the release you want and drop it into your deployment:

```sh
cd path/to/your/oada/deployment
mkdir -p services/trellis-monitor
cd services/trellis-monitor
curl -L https://github.com/trellisfw/monitor/tarball/v2.0.4 | tar xz
cp trellisfw-monitor*/docker-compose.oada.yml .
cp -rf trellisfw-monitor*/support .
```

If using oadadeploy, now run `oadadeploy service refresh`.
If not using oadadeploy, put the contents of docker-compose.oada.yml into your docker-compose.yml
or docker-compose.override.yml manually.

- ./support/target-prod.js:/trellisfw/monitor/dist/monitors/target-prod.js

### docker-compose

## Configuration

Map in additional monitor spec files as `.js` or `.json` to `dist/monitors` if running locally.
Map them to `/trellisfw/monitor/dist/monitors` if running in docker or in an OADA deployment.

Available environment variables:

```yaml
# NAME: override oada.domain as the name we report for ourselves in alerts.
# TESTS: comma-separated list of patterns of test names to run (non-matches excluded)
# TESTS_DIR: override location of monitor spec files to load
PORT: 8080
NODE_TLS_REJECT_UNAUTHORIZED:
NODE_ENV: ${NODE_ENV:-development}
DEBUG: ${DEBUG:-*info*,*warn*,*error*}
# Optional URL to which to POST on notify
notifyurl:
# A token is required for incoming requests to the monitor
incomingToken: foobar
# e.g., run every 15 minutes
CRON: ${MONITOR_CRON:-*/15 * * * *}
# Connect to host if DOMAIN is not set.
# You should really not rely on this though. Set DOMAIN.
DOMAIN: ${DOMAIN:-host.docker.internal}
# Unless your API server is running with development tokens enabled,
# you will need to give the service a token to use.
TOKEN: ${TOKEN:-abc123}
```

[dockerhub]: https://hub.docker.com/repository/docker/trellisfw/monitor
[oada reference api server]: https://github.com/OADA/server

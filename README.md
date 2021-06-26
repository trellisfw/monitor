# trellisfw/monitor

[![License](https://img.shields.io/github/license/trellisfw/trellis-monitor)](LICENSE)
[![Docker Pulls](https://img.shields.io/docker/pulls/trellisfw/monitor)][dockerhub]

This service can monitor an OADA/Trellis installation on a schedule and alert if something fails.

There are a set of available "tests" you can run:
- *maxAge*: alert if a given resource is older than maxage
- *relativeAge*: alert if a "follower" resource is older than maxage from a "leader" resource
- *pathTest*: alert if path does not exist or otherwise returns non-2xx code
- *staleKsuidKeys*: alert if a resource contains any ksuid keys whose timestamp is older than maxage

There are a set of default tests in monitors/default.  You can add additional files
to `dist/monitors` and they will be included in the tests run on the cron schedule.
There are example configs in `examples/`.

Example set of monitors:
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
    desc: "Is the last modified on the email job queue within 15 mins of asns list?",
    type: 'relativeAge',
    params: {
      leader: `/bookmarks/trellisfw/asns`,
      follower: `/bookmarks/services/email/jobs`,
      maxage: 15 * 1000 * 60,
    }
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

## Important Configuration

The token required to retrieve the current monitor status from outside is passed
as an environment variable:
```bash
incomingToken="02ioj3flkfs" yarn run start
```
(see additional usage below for local docker or oada deployment)


## Usage

To run locally:
```bash
yarn run start
```

To run locally in docker:
```bash
docker-compose up -d
```

To run as part of an OADA deployment, just grab the `docker-compose.oada.yml` and
`support` from the release you want and drop it into your deployment:
```bash
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

Here is an example of using this service with docker-compose.

```yaml
services:
  service:
    image: trellisfw/monitor
    restart: unless-stopped
    expose:
      - 8080
    restart: unless-stopped
    environment:
      PORT: 8080
      NODE_TLS_REJECT_UNAUTHORIZED:
      NODE_ENV: ${NODE_ENV:-development}
      DEBUG: ${DEBUG:-*info*,*warn*,*error*}
      # Optional URL to which to POST on notify
      notifyurl:
      # A token require for incoming requests to the monitor
      incomingToken: foobar
      # e.g., run every 15 minutes
      CRON: ${MONITOR_CRON:-*/15 * * * *}
      # Connect to host if DOMAIN not set.
      # You should really not rely on this though. Set DOMAIN.
      DOMAIN: ${DOMAIN:-host.docker.internal}
      # Unless your API server is running with development tokens enabled,
      # you will need to give the service a token to use.
      TOKEN: ${TOKEN:-abc123}
```

### Running trellisfw/monitor within the [OADA Reference API Server]

To add this service to the services run with an OADA v3 server,
simply add a snippet like the one in the previous section
to your `docker-compose.override.yml`.

### External Usage

To run this service separately, simply set the domain and token(s) of the OADA API.

```shell
# Set up the environment.
# Only need to run these the first time.
echo DOMAIN=api.oada.example.com > .env # Set API domain
echo TOKEN=abc123 >> .env # Set API token(s) for the service

# Start the service
docker-compose up -d
```

[dockerhub]: https://hub.docker.com/repository/docker/trellisfw/monitor
[oada reference api server]: https://github.com/OADA/oada-srvc-docker

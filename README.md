[![License](https://img.shields.io/github/license/trellisfw/monitor)](LICENSE)
[![Docker Pulls](https://img.shields.io/docker/pulls/trellisfw/monitor)][dockerhub]

# trellisfw/monitor

## Usage

Docker images for trellisfw/monitor are available from dockerhub.

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

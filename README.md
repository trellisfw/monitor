# trellis-monitis

A microservice to respond to monitoring requests from https://monitis.com

OADA's `proxy` container is configured by this service to route https://domain/monitis-monitor
to this service's port 80.  Therefore, anything that hits https://domain/monitis-monitor with
the appropriate token will trigger the code to run.

The primary purpose of this script at the moment is to monitor Advance Ship Notice (ASN) tasks
to ensure that the ASN pipeline is functioning.  Therefore, hitting this endpoint will post
a test ASN to `/bookmarks/trellisfw/asn-staging`, and wait for the corresponding `_meta/services/target`
to contain "success".


## Installation
```bash
cd /path/to/your/oada-srvc-docker
cd services-available
git clone git@github.com:trellisfw/trellis-monitis.git
cd ../services-enabled
ln -s ../services-available/trellis-monitis .
```

## Overriding defaults for production
Using the `z_tokens/docker-compose.yml` method for `oada-srvc-docker`, the following entry 
will override the defaults:
```docker-compose
  trellis-monitis:
    environment:
      - incomingToken=atokenformonitistouse
      - tokenToRequestAgainstOADA=atokentouseforproductiontrellisrequests
      - domain=https://your.trellis.domain

```


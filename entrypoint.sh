#! /bin/bash

SERVICE_ROOT="/code/trellis-monitor"

chmod u+x ${SERVICE_ROOT}/wait-for-it.sh && \
  ${SERVICE_ROOT}/wait-for-it.sh startup:80 -t 0 && \
  cd ${SERVICE_ROOT}

if [ -z ${DEBUG+x} ]; then export DEBUG="*info*,*warn*,*error*"; fi

if [[ ! -d "node_modules" ]]; then
  echo "${SERVICE_ROOT}: yarn install"
  yarn install
fi

echo "npm run start"
npm run start



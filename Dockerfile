ARG NODE_VER=16-alpine

FROM node:$NODE_VER AS install

WORKDIR /trellis/monitor

COPY ./.yarn /trellis/monitor/.yarn
COPY ./package.json ./yarn.lock ./.yarnrc.yml /trellis/monitor/

RUN yarn workspaces focus --all --production

FROM install AS build

# Install dev deps too
RUN yarn install --immutable

COPY . /trellis/monitor/

# Build code and remove dev deps
RUN yarn build && rm -rfv .yarn .pnp*

FROM node:$NODE_VER AS production

# Do not run service as root
USER node

WORKDIR /trellis/monitor

COPY --from=install /trellis/monitor/ /trellis/monitor/
COPY --from=build /trellis/monitor/ /trellis/monitor/

ENTRYPOINT ["yarn", "run"]
CMD ["start"]

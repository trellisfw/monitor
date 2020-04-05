FROM node:13

COPY ./entrypoint.sh /entrypoint.sh
RUN chmod u+x /entrypoint.sh

WORKDIR /code/trellis-monitis

CMD '/entrypoint.sh'


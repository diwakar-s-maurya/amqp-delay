FROM node:22-slim

RUN mkdir -p /usr/src
WORKDIR /usr/src

RUN chown node:node /usr/src

USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node ./ ./

CMD [ "npm", "start" ]

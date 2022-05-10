FROM node:12

RUN mkdir -p /usr/src
WORKDIR /usr/src

RUN chown node:node /usr/src

USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm install
COPY --chown=node:node ./ ./

CMD [ "npm", "start" ]

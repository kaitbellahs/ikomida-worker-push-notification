FROM  google/cloud-sdk:alpine AS build

ARG PORT 80
ARG GOOGLE_SERVICE_ACCOUNT
ENV GOOGLE_APPLICATION_CREDENTIALS /worker/workerAccount.json

RUN mkdir -p /worker 
WORKDIR /worker

RUN apk update && apk --no-cache -U upgrade && apk add --no-cache npm && npm --global i yarn && echo $GOOGLE_SERVICE_ACCOUNT > /worker/workerAccount_b64 && base64 -d /worker/workerAccount_b64 > $GOOGLE_APPLICATION_CREDENTIALS && gcloud auth activate-service-account --key-file $GOOGLE_APPLICATION_CREDENTIALS && export PATH="$(yarn global bin):$PATH" && yarn global add google-artifactregistry-auth

COPY .npmrc package.json .npmrc .eslintignore .prettierrc api-extractor.json rollup.config.ts tsconfig.json /worker/
RUN yarn glogin && yarn install

COPY ./src /worker/src
RUN yarn build && yarn install --production

FROM node:16-alpine AS final

ENV NODE_ENV production
ENV NODEPORT ${PORT}

RUN apk update && apk --no-cache -U upgrade && addgroup -g 3000  ikomida && deluser --remove-home node && adduser -u 1000 -G ikomida -s /bin/sh -D -h /worker ikomida && chown 1000:3000 /worker
USER ikomida
WORKDIR /worker

COPY --chown=ikomida:ikomida --from=build /worker/package.json ./
COPY --chown=ikomida:ikomida --from=build /worker/node_modules ./node_modules/
COPY --chown=ikomida:ikomida --from=build /worker/build ./build/

EXPOSE ${PORT}

ENTRYPOINT ["node", "build/worker.js"]
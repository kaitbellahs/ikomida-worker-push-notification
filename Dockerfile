FROM  google/cloud-sdk:alpine AS build

ARG GOOGLE_SERVICE_ACCOUNT
ENV GOOGLE_APPLICATION_CREDENTIALS /service/serviceAccount.json

RUN mkdir -p /service 
WORKDIR /service

RUN apk update && apk --no-cache -U upgrade && apk add --no-cache yarn npm && echo $GOOGLE_SERVICE_ACCOUNT > /service/serviceAccount_b64 && base64 -d /service/serviceAccount_b64 > $GOOGLE_APPLICATION_CREDENTIALS && gcloud auth activate-service-account --key-file $GOOGLE_APPLICATION_CREDENTIALS 

COPY .npmrc package.json .npmrc .eslintignore .prettierrc api-extractor.json rollup.config.ts tsconfig.json /service/
COPY ./src /service/src

RUN yarn glogin && yarn install && rm -rf node_modules && yarn install --production

FROM node:16-alpine AS final

ENV NODE_ENV production
ENV NODEPORT ${PORT}

RUN apk update && apk --no-cache -U upgrade && addgroup -g 3000  ikomida && deluser --remove-home node && adduser -u 1000 -G ikomida -s /bin/sh -D -h /service ikomida && chown 1000:3000 /service
USER ikomida
WORKDIR /service

COPY --chown=ikomida:ikomida --from=build /service/package.json ./
COPY --chown=ikomida:ikomida --from=build /service/node_modules ./node_modules/
COPY --chown=ikomida:ikomida --from=build /service/dist ./dist/

ENTRYPOINT ["node", "src/worker.mjs"] 
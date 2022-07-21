FROM node:16-alpine AS build

ARG PORT=80
ARG GITHUBPRIVATEKEY

ENV NODE_ENV production
ENV NODEPORT ${PORT}

RUN apk update && apk --no-cache -U upgrade && apk add --no-cache openssh-client git

USER node

RUN mkdir -p /home/node/app && chown -R node:node /home/node/app && mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo $GITHUBPRIVATEKEY > ~/.ssh/github_b64 && base64 -d ~/.ssh/github_b64 > ~/.ssh/github && chmod 600 ~/.ssh/github && echo "$(~/.ssh/github)" && ssh-keygen -y -e -f ~/.ssh/github > ~/.ssh/github.pub && echo 'SG9zdCBnaXRodWIuY29tCglIb3N0TmFtZSBnaXRodWIuY29tCglVc2VyIGdpdAoJSWRlbnRpdHlGaWxlIH4vLnNzaC9naXRodWI=' >  ~/.ssh/config_b64 && base64 -d  ~/.ssh/config_b64 > ~/.ssh/config && chmod 600  ~/.ssh/config && echo 'github.com,192.30.253.112 ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEAq2A7hRGmdnm9tUDbO9IDSwBK6TbQa+PXYPCPy6rbTrTtw7PHkccKrpp0yVhp5HdEIcKr6pLlVDBfOLX9QUsyCOV0wzfjIJNlGEYsdlLJizHhbn2mUjvSAHQqZETYP81eFzLQNnPHt4EVVUh7VfDESU84KezmD5QlWpXLmvU31/yMf+Se8xhHTvKSCZIFImWwoG6mbUoWf9nzpIoaSjB+weqqUUmpaaasXVal72J+UX2B+2RPW3RcT0eOzQgqlJL3RKrTJvdsjE3JEAvGq3lGHSZXy28G3skua2SmVi/w4yCE6gbODqnTWlg7+wC604ydGXA8VJiS5ap43JXiUFFAaQ==' >  ~/.ssh/known_hosts && chmod 600  ~/.ssh/known_hosts

WORKDIR /home/node/app

COPY --chown=node:node package.json process.yml ./
COPY --chown=node:node ./src ./src

RUN npm i --omit=dev npm@latest pm2 && npm update

FROM node:16-alpine AS final

RUN apk update && apk --no-cache -U upgrade
USER node
COPY --chown=node:node --from=build /home/node/app /home/node/app
WORKDIR /home/node/app

EXPOSE ${PORT}

# ENTRYPOINT ["pm2-runtime", "./process.yml"] 
ENTRYPOINT ["npm", "run", "start"] 
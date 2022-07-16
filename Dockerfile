FROM node:16-alpine AS final

ARG GITHUBPRIVATEKEY
ARG NODEENV=production

ENV NODE_ENV production

RUN apk update
RUN apk --no-cache -U upgrade
RUN apk add --no-cache openssh-client git
RUN npm cache verify
RUN npm i --location=global npm@latest

USER node

RUN mkdir -p /home/node/app && chown -R node:node /home/node/app

RUN mkdir -p ~/.ssh
RUN chmod 700 ~/.ssh
RUN echo $GITHUBPRIVATEKEY > ~/.ssh/github_b64
RUN base64 -d ~/.ssh/github_b64 > ~/.ssh/github
RUN chmod 600 ~/.ssh/github
RUN ssh-keygen -y -e -f ~/.ssh/github > ~/.ssh/github.pub
RUN echo 'SG9zdCBnaXRodWIuY29tCglIb3N0TmFtZSBnaXRodWIuY29tCglVc2VyIGdpdAoJSWRlbnRpdHlGaWxlIH4vLnNzaC9naXRodWI=' >  ~/.ssh/config_b64
RUN base64 -d  ~/.ssh/config_b64 > ~/.ssh/config
RUN chmod 600  ~/.ssh/config
RUN echo 'github.com,192.30.253.112 ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEAq2A7hRGmdnm9tUDbO9IDSwBK6TbQa+PXYPCPy6rbTrTtw7PHkccKrpp0yVhp5HdEIcKr6pLlVDBfOLX9QUsyCOV0wzfjIJNlGEYsdlLJizHhbn2mUjvSAHQqZETYP81eFzLQNnPHt4EVVUh7VfDESU84KezmD5QlWpXLmvU31/yMf+Se8xhHTvKSCZIFImWwoG6mbUoWf9nzpIoaSjB+weqqUUmpaaasXVal72J+UX2B+2RPW3RcT0eOzQgqlJL3RKrTJvdsjE3JEAvGq3lGHSZXy28G3skua2SmVi/w4yCE6gbODqnTWlg7+wC604ydGXA8VJiS5ap43JXiUFFAaQ==' >  ~/.ssh/known_hosts
RUN chmod 600  ~/.ssh/known_hosts

WORKDIR /home/node/app

COPY --chown=node:node package.json ./
COPY --chown=node:node ./src ./src

# RUN npm cache verify
RUN npm cache verify
RUN npm i --omit=dev
RUN npm update
RUN npm audit

ENTRYPOINT ["npm", "run", "worker"]
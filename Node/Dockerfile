FROM node:14.17

COPY package.json ./

COPY ubiq ./

RUN npm install

COPY . . 

EXPOSE 8009

RUN useradd -u 8877 ubiq

USER ubiq

CMD ["node","app.js"]
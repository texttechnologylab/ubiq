FROM node:14.21.2

COPY . .

RUN npm install

EXPOSE 8009

RUN useradd -u 8877 ubiq

USER ubiq

CMD ["node","app.js"]
import { Server } from 'hyper-express';

const server = new Server();

server.get('/', (_, res) => {
  res.json({ msg: 'Hello World' });
});

server.listen(3000);

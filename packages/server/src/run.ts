import { CommandCenterServer } from './server';

const server = new CommandCenterServer(3333);
server.start().then(() => {
  console.log('Server started on port 3333');
}).catch(console.error);

process.on('SIGINT', async () => {
  await server.stop();
  process.exit(0);
});

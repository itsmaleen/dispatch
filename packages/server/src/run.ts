import { CommandCenterServer } from './server';

const port = parseInt(process.env.ACC_SERVER_PORT || '3333', 10);
const server = new CommandCenterServer(port);

server.start().then(() => {
  // Use server.port which has the actual bound port (may differ if original was in use)
  console.log(`Server started on port ${server.port}`);
}).catch(console.error);

process.on('SIGINT', async () => {
  await server.stop();
  process.exit(0);
});

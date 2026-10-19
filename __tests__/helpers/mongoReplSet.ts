// ADR-029: audited Mongo mutations run in transactions, which need a replica set.
// Drop-in replacement for MongoMemoryServer in API tests. A single-node replica set is started
// as a standalone mongod with --replSet and initiated with the app's own driver (the driver nested
// in mongodb-memory-server-core cannot handshake with the current mongod binary).
import { MongoMemoryServer as BaseServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

export class MongoMemoryServer {
  private constructor(private server: BaseServer, private uri: string) {}

  static async create(): Promise<MongoMemoryServer> {
    const server = await BaseServer.create({ instance: { replSet: 'rs0', storageEngine: 'wiredTiger' } });
    const direct = server.getUri().replace(/\/?(\?.*)?$/, '/?directConnection=true');
    const client = new MongoClient(direct);
    try {
      await client.connect();
      await client.db('admin').command({
        replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: `127.0.0.1:${new URL(direct).port}` }] },
      });
      for (let i = 0; i < 100; i++) {
        const hello = await client.db('admin').command({ hello: 1 });
        if (hello.isWritablePrimary) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      await client.close();
    }
    return new MongoMemoryServer(server, direct);
  }

  getUri(): string {
    return this.uri;
  }

  async stop(): Promise<boolean> {
    const instance = this.server.instanceInfo?.instance;
    const mongodProcess = instance?.mongodProcess;
    if (mongodProcess && mongodProcess.exitCode === null && mongodProcess.signalCode === null) {
      const exited = new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          if (mongodProcess.exitCode === null && mongodProcess.signalCode === null) mongodProcess.kill('SIGKILL');
        }, 1000);
        mongodProcess.once('exit', () => {
          clearTimeout(killTimer);
          resolve();
        });
      });
      mongodProcess.kill('SIGTERM');
      await exited;
      instance.mongodProcess = undefined;
    }
    return this.server.stop({ doCleanup: true, force: true });
  }
}

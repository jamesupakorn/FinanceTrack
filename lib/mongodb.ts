import { MongoClient, type MongoClientOptions, type Db } from 'mongodb';
import dns from 'dns';

const options: MongoClientOptions = {};

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient> | undefined;

type MongoGlobal = typeof globalThis & { _mongoClientPromise?: Promise<MongoClient> };
const mongoGlobal = globalThis as MongoGlobal;

let dnsConfigured = false;

function configureMongoDnsResolvers(): void {
  if (dnsConfigured) return;
  const configured = process.env.MONGODB_DNS_SERVERS || '';
  if (!configured) {
    dnsConfigured = true;
    return;
  }
  const servers = configured
    .split(',')
    .map(server => server.trim())
    .filter(Boolean);
  if (!servers.length) {
    dnsConfigured = true;
    return;
  }
  try {
    dns.setServers(servers);
  } catch (error: unknown) {
    const message = (error as { message?: unknown } | null)?.message || error;
    console.warn('Invalid MONGODB_DNS_SERVERS value:', message);
  } finally {
    dnsConfigured = true;
  }
}

function createClientPromise(uri: string): Promise<MongoClient> {
  configureMongoDnsResolvers();
  if (process.env.NODE_ENV === 'development') {
    if (!mongoGlobal._mongoClientPromise) {
      client = new MongoClient(uri, options);
      mongoGlobal._mongoClientPromise = client.connect().catch((err: Error) => {
        mongoGlobal._mongoClientPromise = undefined;
        throw err;
      });
    }
    return mongoGlobal._mongoClientPromise;
  }

  if (!clientPromise) {
    client = new MongoClient(uri, options);
    clientPromise = client.connect().catch((err: Error) => {
      clientPromise = undefined;
      throw err;
    });
  }
  return clientPromise;
}

export function getDbPromise(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('Please add your Mongo URI to .env.local');
  }

  return createClientPromise(uri).then(connectedClient => connectedClient.db('financetrack'));
}
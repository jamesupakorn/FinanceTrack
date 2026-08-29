import { MongoClient } from 'mongodb';
import dns from 'dns';

const options = {};

let client;
let clientPromise;

let dnsConfigured = false;

function configureMongoDnsResolvers() {
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
  } catch (error) {
    console.warn('Invalid MONGODB_DNS_SERVERS value:', error?.message || error);
  } finally {
    dnsConfigured = true;
  }
}

function createClientPromise(uri) {
  configureMongoDnsResolvers();
  if (process.env.NODE_ENV === 'development') {
    if (!global._mongoClientPromise) {
      client = new MongoClient(uri, options);
      global._mongoClientPromise = client.connect().catch((err) => {
        global._mongoClientPromise = undefined;
        throw err;
      });
    }
    return global._mongoClientPromise;
  }

  if (!clientPromise) {
    client = new MongoClient(uri, options);
    clientPromise = client.connect().catch((err) => {
      clientPromise = undefined;
      throw err;
    });
  }
  return clientPromise;
}

export function getDbPromise() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('Please add your Mongo URI to .env.local');
  }

  return createClientPromise(uri).then(connectedClient => connectedClient.db('financetrack'));
}

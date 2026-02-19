import { MongoClient } from 'mongodb';

const options = {};

let client;
let clientPromise;

function createClientPromise(uri) {
  if (process.env.NODE_ENV === 'development') {
    if (!global._mongoClientPromise) {
      client = new MongoClient(uri, options);
      global._mongoClientPromise = client.connect();
    }
    return global._mongoClientPromise;
  }

  if (!clientPromise) {
    client = new MongoClient(uri, options);
    clientPromise = client.connect();
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

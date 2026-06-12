import { assertApiToken } from '../../src/shared/utils/backend/apiTokenAuth';
import { getMongoCollection, isJsonMode } from '../../lib/dataSource';
const { loadUsers } = require('../../src/backend/data/userUtils');

export default async function handler(req, res) {
  if (!assertApiToken(req, res)) {
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    let users = [];
    if (isJsonMode()) {
      users = loadUsers().map(user => ({
        id: user.id,
        displayName: user.displayName,
        avatar: user.avatar
      }));
    } else {
      const collection = await getMongoCollection('users');
      const docs = await collection
        .find({}, { projection: { _id: 0, id: 1, displayName: 1, avatar: 1 } })
        .toArray();
      users = docs
        .filter(user => typeof user?.id === 'string' && user.id.length > 0)
        .map(user => ({
          id: user.id,
          displayName: user.displayName || user.id,
          avatar: user.avatar || ''
        }));
    }

    return res.status(200).json({ users });
  } catch (error) {
    console.error('โหลดข้อมูลผู้ใช้ไม่สำเร็จ', error);
    return res.status(500).json({ error: 'ไม่สามารถโหลดรายชื่อผู้ใช้ได้' });
  }
}

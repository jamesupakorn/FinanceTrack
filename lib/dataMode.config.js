const envMode = (process.env.DATA_MODE || '').toLowerCase();

const dataModeConfig = {
  // ปรับค่าเป็น 'mongo' เมื่อต้องการให้ backend ไปอ่านจาก MongoDB
  // ปรับค่าเป็น 'json' เมื่อต้องการให้ backend ไปอ่านจาก JSON files
  mode: envMode === 'mongo' ? 'mongo' : 'json'
};

export default dataModeConfig;

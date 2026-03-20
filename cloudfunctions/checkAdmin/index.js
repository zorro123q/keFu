// 云函数：checkAdmin
// 作用：检查当前用户是否是管理员
const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function getSession(token) {
  const tokenDigest = sha256Hex(String(token || ''));
  const now = new Date();
  const sessRes = await db.collection('sessions').where({ tokenDigest, expireAt: _.gt(now) }).limit(1).get();
  return (sessRes.data && sessRes.data[0]) ? sessRes.data[0] : null;
}

function parseAdminPhones() {
  const raw = String(process.env.ADMIN_PHONES || '').trim();
  if (!raw) return [];
  return raw
    .split(/[\s,;，；]+/g)
    .map(s => String(s || '').trim())
    .filter(Boolean);
}

function isAdminPhone(phone) {
  const p = String(phone || '').trim();
  if (!p) return false;
  const list = parseAdminPhones();
  if (list.length === 0) return false;
  return list.includes(p);
}

exports.main = async (event, context) => {
  const token = event && event.token;

  try {
    const sess = await getSession(token);
    if (!sess) {
      return { success: true, isAdmin: false };
    }
    const adminPhones = parseAdminPhones();
    if (adminPhones.length === 0) {
      return { success: true, isAdmin: false, message: '管理员白名单未配置' };
    }

    return {
      success: true,
      isAdmin: isAdminPhone(sess.phone)
    };
  } catch (err) {
    console.error('检查管理员权限失败', err);
    return {
      success: false,
      isAdmin: false,
      message: err.message
    };
  }
};

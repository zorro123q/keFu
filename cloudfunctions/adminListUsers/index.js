const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function requireSession(token) {
  const tokenDigest = sha256Hex(String(token || ''));
  const now = new Date();
  const sessRes = await db.collection('sessions').where({ tokenDigest, expireAt: _.gt(now) }).limit(1).get();
  if (!sessRes.data || sessRes.data.length === 0) {
    const err = new Error('NEED_LOGIN');
    err.code = 'NEED_LOGIN';
    throw err;
  }
  return sessRes.data[0];
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
  const {
    page = 1,
    pageSize = 20,
    keyword = '',
    level = '',
    token
  } = event || {};

  const size = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
  const skip = Math.max(parseInt(page, 10) - 1, 0) * size;

  try {
    const sess = await requireSession(token);
    const adminPhones = parseAdminPhones();
    if (adminPhones.length === 0) {
      return { success: false, message: '管理员白名单未配置' };
    }
    if (!isAdminPhone(sess.phone)) {
      return { success: false, message: 'no permission' };
    }

    let where = {};
    if (keyword) {
      where.name = db.RegExp({ regexp: keyword, options: 'i' });
    }
    if (level) {
      where.level = level;
    }

    const totalRes = await db.collection('users').where(where).count();
    const listRes = await db.collection('users')
      .where(where)
      .orderBy('createTime', 'desc')
      .skip(skip)
      .limit(size)
      .get();

    return {
      success: true,
      total: totalRes.total || 0,
      list: listRes.data || []
    };
  } catch (err) {
    console.error('admin list users failed', err);
    return { success: false, message: err.message || 'failed' };
  }
};

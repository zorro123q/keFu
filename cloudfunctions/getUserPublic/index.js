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

function maskPhone(p) {
  if (!p || typeof p !== 'string') return '';
  if (p.length < 7) return p;
  return p.slice(0, 3) + '****' + p.slice(-4);
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { userId, targetOpenid, token } = event || {};

  try {
    let userDoc = null;
    if (userId) {
      const u = await db.collection('users').doc(userId).get();
      userDoc = u.data;
    } else if (targetOpenid) {
      const u = await db.collection('users').where({ _openid: targetOpenid }).get();
      userDoc = (u.data && u.data[0]) || null;
    } else {
      const sess = await requireSession(token);
      const u = await db.collection('users').doc(sess.userId).get();
      userDoc = u.data || null;
    }

    if (!userDoc) {
      return { success: false, message: '用户不存在' };
    }

    // 取最高证书（按 level 降序，limit 1）
    const certRes = await db.collection('certificates')
      .where({ userId: userDoc._id })
      .orderBy('level', 'desc')
      .limit(1)
      .get();

    const topCert = (certRes.data && certRes.data[0]) ? {
      certName: certRes.data[0].certName,
      level: certRes.data[0].level,
      issueDate: certRes.data[0].issueDate
    } : null;

    // 返回脱敏后的公用信息
    const userPublic = {
      _id: userDoc._id,
      name: userDoc.name || '',
      avatar: userDoc.avatar || '',
      level: userDoc.level || 'junior',
      points: userDoc.points || 0,
      totalPoints: userDoc.totalPoints || 0,
      phoneMasked: maskPhone(userDoc.phone || ''),
      createTime: userDoc.createTime,
      topCertificate: topCert
    };

    return { success: true, userPublic };
  } catch (err) {
    console.error('获取用户公用信息失败', err);
    return { success: false, message: err.message || '获取失败' };
  }
};

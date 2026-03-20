// 云函数入口文件
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

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const { userId, points, reason, token } = event || {};

  // 验证参数
  if (!userId || !points || points <= 0 || !reason) {
    return {
      success: false,
      message: '参数错误'
    };
  }

  const transaction = await db.startTransaction();

  try {
    // 1. 验证管理员权限
    const sess = await requireSession(token);
    const adminPhones = parseAdminPhones();
    if (adminPhones.length === 0) {
      await transaction.rollback();
      return { success: false, message: '管理员白名单未配置' };
    }
    if (!isAdminPhone(sess.phone)) {
      await transaction.rollback();
      return {
        success: false,
        message: '无管理员权限'
      };
    }

    // 2. 查询用户信息
    const userRes = await transaction.collection('users').doc(userId).get();
    if (!userRes.data) {
      await transaction.rollback();
      return {
        success: false,
        message: '用户不存在'
      };
    }

    const user = userRes.data;
    const now = new Date();

    // 3. 增加用户积分
    const newPoints = (user.points || 0) + points;
    const newTotalPoints = (user.totalPoints || 0) + points;

    await transaction.collection('users').doc(userId).update({
      data: {
        points: newPoints,
        totalPoints: newTotalPoints,
        updateTime: now
      }
    });

    // 4. 记录积分日志
    await transaction.collection('points_logs').add({
      data: {
        userId,
        type: 'earn',
        amount: points,
        balance: newPoints,
        reason,
        operatorId: sess.userId,
        createTime: now
      }
    });

    // 注意：等级不再与积分数量绑定，等级通过手机号/身份证从系统数据库匹配
    // 这里不再自动更新等级

    await transaction.commit();

    return {
      success: true,
      newPoints,
      currentLevel: user.level
    };
  } catch (err) {
    console.error('发放积分失败', err);
    await transaction.rollback();
    return {
      success: false,
      message: err.message || '发放积分失败'
    };
  }
};

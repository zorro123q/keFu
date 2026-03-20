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
  const { exchangeCode, token, action = 'verify' } = event || {};

  if (!exchangeCode) {
    return {
      success: false,
      message: '请提供兑换码'
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

    // 2. 查询订单
    const orderRes = await transaction.collection('orders')
      .where({
        exchangeCode
      })
      .get();

    if (orderRes.data.length === 0) {
      await transaction.rollback();
      return {
        success: false,
        message: '订单不存在'
      };
    }

    const order = orderRes.data[0];

    if (action === 'get') {
      await transaction.commit();
      return {
        success: true,
        order
      };
    }

    // 3. 检查订单状态
    if (order.status === 'completed') {
      await transaction.rollback();
      return {
        success: false,
        message: '订单已核销'
      };
    }

    if (order.status === 'cancelled') {
      await transaction.rollback();
      return {
        success: false,
        message: '订单已取消'
      };
    }

    const now = new Date();

    // 4. 更新订单状态为已完成
    await transaction.collection('orders').doc(order._id).update({
      data: {
        status: 'completed',
        verifyTime: now,
        updateTime: now
      }
    });

    await transaction.commit();

    return {
      success: true,
      orderId: order._id
    };
  } catch (err) {
    console.error('核销失败', err);
    await transaction.rollback();
    return {
      success: false,
      message: err.message || '核销失败'
    };
  }
};

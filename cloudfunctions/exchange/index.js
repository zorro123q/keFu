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

// 生成订单号
function generateOrderNo() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${year}${month}${day}${random}`;
}

// 生成兑换码
function generateExchangeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 云函数入口函数
exports.main = async (event, context) => {
  const { goodsId, addressId, remark, token } = event || {};
  const sess = await requireSession(token);
  const userId = sess.userId;

  const transaction = await db.startTransaction();

  try {
    // 1. 查询商品信息
    const goodsRes = await transaction.collection('goods').doc(goodsId).get();
    if (!goodsRes.data) {
      await transaction.rollback();
      return {
        success: false,
        message: '商品不存在'
      };
    }

    const goods = goodsRes.data;

    // 2. 检查商品状态和库存
    if (goods.status !== 'on') {
      await transaction.rollback();
      return {
        success: false,
        message: '商品已下架'
      };
    }

    if (goods.stock <= 0) {
      await transaction.rollback();
      return {
        success: false,
        message: '商品库存不足'
      };
    }

    // 3. 查询用户信息
    const userRes = await transaction.collection('users').doc(userId).get();
    if (!userRes.data) {
      await transaction.rollback();
      return {
        success: false,
        message: '用户不存在'
      };
    }

    const user = userRes.data;

    // 4. 检查积分是否足够
    if (user.points < goods.points) {
      await transaction.rollback();
      return {
        success: false,
        message: '积分不足'
      };
    }

    // 5. 查询收货地址
    const addressRes = await transaction.collection('addresses').doc(addressId).get();
    if (!addressRes.data || addressRes.data.userId !== userId) {
      await transaction.rollback();
      return {
        success: false,
        message: '收货地址不存在'
      };
    }

    const address = addressRes.data;

    const now = new Date();
    const orderNo = generateOrderNo();
    const exchangeCode = generateExchangeCode();

    // 6. 扣减用户积分
    await transaction.collection('users').doc(user._id).update({
      data: {
        points: _.inc(-goods.points),
        updateTime: now
      }
    });

    // 7. 扣减商品库存，增加销量
    await transaction.collection('goods').doc(goodsId).update({
      data: {
        stock: _.inc(-1),
        sold: _.inc(1),
        updateTime: now
      }
    });

    // 8. 创建订单
    const orderData = {
      orderNo,
      userId: user._id,
      goodsId,
      goodsName: goods.name,
      goodsImage: goods.images[0] || '',
      points: goods.points,
      status: 'pending',
      address: {
        name: address.name,
        phone: address.phone,
        province: address.province,
        city: address.city,
        district: address.district,
        detail: address.detail
      },
      remark: remark || '',
      exchangeCode,
      createTime: now,
      updateTime: now
    };

    const orderRes = await transaction.collection('orders').add({
      data: orderData
    });

    // 9. 记录积分日志
    await transaction.collection('points_logs').add({
      data: {
        userId: user._id,
        type: 'spend',
        amount: goods.points,
        balance: user.points - goods.points,
        reason: `兑换商品：${goods.name}`,
        relatedId: orderRes._id,
        createTime: now
      }
    });

    // 注意：等级不再与积分数量绑定，等级通过手机号/身份证从系统数据库匹配
    // 这里不再自动更新等级

    await transaction.commit();

    return {
      success: true,
      orderId: orderRes._id,
      orderNo,
      exchangeCode
    };
  } catch (err) {
    console.error('兑换失败', err);
    await transaction.rollback();
    return {
      success: false,
      message: err.message || '兑换失败'
    };
  }
};

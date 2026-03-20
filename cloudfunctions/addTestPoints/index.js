// 云函数：addTestPoints
// 作用：为当前用户添加一笔测试积分记录
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

exports.main = async (event, context) => {
  const sess = await requireSession(event && event.token);

  try {
    // 1. 获取用户信息，拿到当前积分
    const userRes = await db.collection('users').doc(sess.userId).get();
    if (!userRes.data) {
      return { success: false, message: '用户不存在' };
    }
    const currentUser = userRes.data;
    const currentPoints = currentUser.points || 0;

    const pointsToAdd = 50;
    const newBalance = currentPoints + pointsToAdd;

    // 2. 在 points_logs 集合中添加一条记录
    await db.collection('points_logs').add({
      data: {
        userId: currentUser._id, // 关联用户ID
        amount: pointsToAdd,
        balance: newBalance,
        reason: '后台测试奖励',
        type: 'earn',
        createTime: new Date()
      }
    });

    // 3. 更新 users 集合中的用户总积分
    await db.collection('users').doc(currentUser._id).update({
      data: {
        points: _.inc(pointsToAdd),
        totalPoints: _.inc(pointsToAdd)
      }
    });

    return { success: true, message: '添加成功' };

  } catch (err) {
    console.error('添加测试积分失败', err);
    return {
      success: false,
      message: err.message
    };
  }
};

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

function getTodayKey(date) {
  const offsetMs = 8 * 60 * 60 * 1000;
  const t = new Date(date.getTime() + offsetMs);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function isDuplicateError(err) {
  const msg = String(err && (err.message || err.errMsg || err.errmsg || err));
  const code = err && (err.code || err.errCode || err.statusCode);
  return (
    code === 11000 ||
    code === 409 ||
    msg.includes('duplicate') ||
    msg.includes('duplicat') ||
    msg.includes('E11000') ||
    msg.includes('exists') ||
    msg.includes('Exist') ||
    msg.includes('conflict') ||
    msg.includes('Conflict') ||
    msg.includes('已存在') ||
    msg.includes('重复')
  );
}

exports.main = async (event) => {
  const { token } = event || {};
  const sess = await requireSession(token);
  const now = new Date();
  const todayKey = getTodayKey(now);

  const pointsToAdd = 10;
  const logId = `checkin_${sess.userId}_${todayKey}`;

  const transaction = await db.startTransaction();

  try {
    const userRes = await transaction.collection('users').doc(sess.userId).get();
    if (!userRes.data) {
      await transaction.rollback();
      return {
        success: false,
        message: '用户不存在'
      };
    }

    const user = userRes.data;
    const currentPoints = user.points || 0;
    const newBalance = currentPoints + pointsToAdd;

    try {
      await transaction.collection('points_logs').add({
        data: {
          _id: logId,
          userId: user._id,
          type: 'earn',
          amount: pointsToAdd,
          balance: newBalance,
          reason: '每日签到',
          createTime: now
        }
      });
    } catch (err) {
      if (isDuplicateError(err)) {
        await transaction.rollback();
        return {
          success: true,
          alreadyCheckedIn: true,
          message: '今天已签到'
        };
      }
      throw err;
    }

    await transaction.collection('users').doc(user._id).update({
      data: {
        points: _.inc(pointsToAdd),
        totalPoints: _.inc(pointsToAdd),
        updateTime: now
      }
    });

    await transaction.commit();

    return {
      success: true,
      alreadyCheckedIn: false,
      addedPoints: pointsToAdd,
      newBalance
    };
  } catch (err) {
    if (isDuplicateError(err)) {
      await transaction.rollback();
      return {
        success: true,
        alreadyCheckedIn: true,
        message: '今天已签到'
      };
    }

    await transaction.rollback();
    return {
      success: false,
      message: err.message || '签到失败'
    };
  }
};

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
  const {
    name = '',
    avatar = '',
    phone = '',
    idCard = '',
    school = '',
    degree = '',
    company = '',
    role = '',
    experience = '',
    trainingIntention = '',
    referralCode,
    education,
    position,
    workYears,
    isTrained,
    recommendCode,
    token
  } = event || {};

  const now = new Date();
  const transaction = await db.startTransaction();

  try {
    const educationOptions = ['高中及以下', '大专', '本科', '硕士', '博士'];
    const normalizedDegree = degree || (typeof education !== 'undefined' ? (educationOptions[Number(education)] || '') : '');
    const normalizedRole = role || position || '';
    const normalizedExperience = experience || (typeof workYears !== 'undefined' ? String(workYears) : '');
    const normalizedTrainingIntention = trainingIntention || (typeof isTrained !== 'undefined' ? (Number(isTrained) === 1 ? '是' : '否') : '');
    const normalizedReferralCode = referralCode || recommendCode;
    const sess = await requireSession(token);
    const userRes = await transaction.collection('users').doc(sess.userId).get();
    if (!userRes.data) {
      await transaction.rollback();
      return { success: false, message: '用户不存在' };
    }

    const user = userRes.data;
    const updateData = {
      updateTime: now
    };

    if (name) updateData.name = name;
    if (avatar) updateData.avatar = avatar;
    if (phone) updateData.phone = phone;
    if (idCard) updateData.idCard = idCard;
    if (school) updateData.school = school;
    if (company) updateData.company = company;
    if (normalizedDegree) updateData.degree = normalizedDegree;
    if (normalizedRole) updateData.role = normalizedRole;
    if (normalizedExperience) updateData.experience = normalizedExperience;
    if (normalizedTrainingIntention) updateData.trainingIntention = normalizedTrainingIntention;
    if (!user.referralCode) updateData.referralCode = String(user._id || '').slice(-8);

    await transaction.collection('users').doc(user._id).update({ data: updateData });

    const reward = 50;
    if (normalizedReferralCode && normalizedReferralCode !== updateData.referralCode && !user.referredBy) {
      const refRes = await transaction.collection('users').where({ referralCode: normalizedReferralCode }).get();
      if (refRes.data && refRes.data.length > 0) {
        const refUser = refRes.data[0];
        if (refUser && refUser._id && refUser._id !== user._id) {
          await transaction.collection('users').doc(refUser._id).update({
            data: {
              points: _.inc(reward),
              totalPoints: _.inc(reward),
              updateTime: now
            }
          });
          await transaction.collection('points_logs').add({
            data: {
              userId: refUser._id,
              type: 'earn',
              amount: reward,
              balance: (refUser.points || 0) + reward,
              reason: `引荐奖励：${updateData.name || user.name || ''}`,
              relatedId: user._id,
              createTime: now
            }
          });
          await transaction.collection('users').doc(user._id).update({
            data: {
              referredBy: normalizedReferralCode,
              updateTime: now
            }
          });
        }
      }
    }

    await transaction.commit();

    const merged = { ...user, ...updateData };
    return {
      success: true,
      existed: true,
      userPublic: {
        _id: merged._id,
        name: merged.name,
        avatar: merged.avatar,
        level: merged.level,
        points: merged.points,
        totalPoints: merged.totalPoints,
        phoneMasked: maskPhone(merged.phone || ''),
        createTime: merged.createTime
      }
    };
  } catch (err) {
    await transaction.rollback();
    console.error('注册失败', err);
    return {
      success: false,
      message: err.message || '注册失败'
    };
  }
};

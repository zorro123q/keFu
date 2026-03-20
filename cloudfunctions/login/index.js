// 云函数入口文件
const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

function createSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(String(phone || ''));
}

function createSixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function upsertUserByPhone({ normalizedPhone, idCard, referralCodeInput, openid }) {
  const now = new Date();
  const userByPhoneRes = await db.collection('users').where({ phone: normalizedPhone }).limit(1).get();
  const userExists = userByPhoneRes.data && userByPhoneRes.data.length > 0;
  const isNewUser = !userExists;
  let userInfo;

  if (userExists) {
    userInfo = userByPhoneRes.data[0];
    const level = await getUserLevelFromSystem(normalizedPhone, idCard || userInfo.idCard);
    const updateData = {
      phone: normalizedPhone,
      idCard: idCard || userInfo.idCard || '',
      level,
      updateTime: now,
      lastOpenid: openid || ''
    };
    if (!userInfo.referralCode) {
      updateData.referralCode = String(userInfo._id || '').slice(-8);
    }

    await db.collection('users').doc(userInfo._id).update({ data: updateData });
    userInfo = { ...userInfo, ...updateData };
    return { userInfo, isNewUser };
  }

  const level = await getUserLevelFromSystem(normalizedPhone, idCard);
  const newUser = {
    phone: normalizedPhone,
    idCard: idCard || '',
    name: '学员' + normalizedPhone.slice(-6),
    avatar: '',
    level,
    points: 0,
    totalPoints: 0,
    createTime: now,
    updateTime: now,
    school: '',
    degree: '',
    company: '',
    role: '',
    experience: '',
    trainingIntention: '',
    referralCode: '',
    lastOpenid: openid || ''
  };

  const transaction = await db.startTransaction();
  try {
    const addRes = await transaction.collection('users').add({ data: newUser });
    const newUserId = addRes._id;
    const selfReferralCode = String(newUserId).slice(-8);
    await transaction.collection('users').doc(newUserId).update({
      data: {
        referralCode: selfReferralCode,
        updateTime: now
      }
    });

    userInfo = { _id: newUserId, ...newUser, referralCode: selfReferralCode };

    const referralRewardPoints = 50;
    if (referralCodeInput && referralCodeInput !== selfReferralCode) {
      const refRes = await transaction.collection('users').where({ referralCode: referralCodeInput }).get();
      if (refRes.data && refRes.data.length > 0) {
        const refUser = refRes.data[0];
        if (refUser && refUser._id && refUser._id !== newUserId) {
          await transaction.collection('users').doc(refUser._id).update({
            data: {
              points: _.inc(referralRewardPoints),
              totalPoints: _.inc(referralRewardPoints),
              updateTime: now
            }
          });
          await transaction.collection('points_logs').add({
            data: {
              userId: refUser._id,
              type: 'earn',
              amount: referralRewardPoints,
              balance: (refUser.points || 0) + referralRewardPoints,
              reason: `引荐奖励：${userInfo.name}`,
              relatedId: newUserId,
              createTime: now
            }
          });
        }
      }
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return { userInfo, isNewUser: true };
}

async function migrateUserIdByOpenid({ userId, openids }) {
  const enabled = String(process.env.MIGRATE_BY_OPENID || '').trim() === '1';
  if (!enabled) return;
  const list = Array.from(new Set((openids || []).filter(Boolean)));
  if (list.length === 0) return;
  await db.collection('points_logs').where({ _openid: _.in(list) }).update({ data: { userId } });
  await db.collection('orders').where({ _openid: _.in(list) }).update({ data: { userId } });
  await db.collection('addresses').where({ _openid: _.in(list) }).update({ data: { userId } });
}

// 根据手机号或身份证从系统数据库匹配等级
async function getUserLevelFromSystem(phone, idCard) {
  try {
    // 查询系统等级映射表
    // 这里假设存在一个 level_mappings 集合，存储手机号/身份证与等级的映射关系
    // 实际项目中需要根据实际的系统数据库结构进行调整
    let query = {};
    if (phone) {
      query.phone = phone;
    }
    if (idCard) {
      query.idCard = idCard;
    }

    if (phone || idCard) {
      const mappingRes = await db.collection('level_mappings')
        .where(query)
        .get();

      if (mappingRes.data.length > 0) {
        return mappingRes.data[0].level;
      }
    }
  } catch (err) {
    console.error('查询等级映射失败', err);
  }

  // 默认返回初级
  return 'junior';
}

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const { OPENID } = wxContext;
  const {
    action = 'check',
    phone,
    code,
    password,
    idCard,
    referralCode: referralCodeInput,
    debug,
    token,
    phoneCode
  } = event || {};

  try {
    if (action === 'sendCode') {
      if (!isValidPhone(phone)) {
        return { success: false, message: '手机号格式不正确' };
      }

      if (!debug) {
        return { success: false, message: '未接入短信服务，请使用开发版调试验证码' };
      }

      const now = new Date();
      const expireAt = new Date(Date.now() + 5 * 60 * 1000);
      const testCode = String(process.env.TEST_SMS_CODE || '123456').trim();
      const smsCode = /^\d{6}$/.test(testCode) ? testCode : createSixDigitCode();
      const salt = createSalt();
      const codeHash = sha256Hex(salt + smsCode);

      await db.collection('sms_codes').where({ phone: String(phone) }).remove();
      await db.collection('sms_codes').add({
        data: {
          phone: String(phone),
          salt,
          codeHash,
          createTime: now,
          expireAt
        }
      });

      return {
        success: true,
        debugCode: smsCode
      };
    }

    if (action === 'wxPhoneLogin') {
      const phoneCodeValue = String(phoneCode || '').trim();
      if (!phoneCodeValue) {
        return { success: false, message: '缺少手机号授权 code' };
      }

      let phoneInfoRes;
      try {
        phoneInfoRes = await cloud.openapi.phonenumber.getPhoneNumber({ code: phoneCodeValue });
      } catch (e) {
        const msg = String(e && (e.message || e.errMsg || e.errmsg || e));
        return { success: false, message: msg || '获取手机号失败' };
      }

      const phoneNumber = phoneInfoRes && phoneInfoRes.phoneInfo && phoneInfoRes.phoneInfo.phoneNumber;
      if (!isValidPhone(phoneNumber)) {
        return { success: false, message: '获取到的手机号无效' };
      }

      const normalizedPhone = String(phoneNumber);
      const { userInfo, isNewUser } = await upsertUserByPhone({
        normalizedPhone,
        idCard,
        referralCodeInput,
        openid: OPENID || ''
      });

      const openidsToMigrate = [];
      if (userInfo && userInfo._openid) openidsToMigrate.push(userInfo._openid);
      if (OPENID && (!userInfo || !userInfo._openid || userInfo._openid !== OPENID)) openidsToMigrate.push(OPENID);
      await migrateUserIdByOpenid({ userId: userInfo._id, openids: openidsToMigrate });

      const now = new Date();
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenDigest = sha256Hex(sessionToken);
      const expireAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.collection('sessions').where({ userId: userInfo._id }).remove();
      await db.collection('sessions').add({
        data: {
          tokenDigest,
          userId: userInfo._id,
          phone: normalizedPhone,
          createTime: now,
          expireAt
        }
      });

      const hasPassword = !!(userInfo && userInfo.passwordHash);
      return { success: true, token: sessionToken, userInfo, isNewUser, hasPassword };
    }

    if (action === 'verifyCode') {
      if (!isValidPhone(phone)) {
        return { success: false, message: '手机号格式不正确' };
      }

      const normalizedCode = String(code || '').trim();
      if (!/^\d{6}$/.test(normalizedCode)) {
        return { success: false, message: '验证码格式不正确' };
      }

      const now = new Date();
      const testCode = String(process.env.TEST_SMS_CODE || '123456').trim();
      if (debug && normalizedCode === testCode) {
        const normalizedPhone = String(phone);
        const { userInfo, isNewUser } = await upsertUserByPhone({
          normalizedPhone,
          idCard,
          referralCodeInput,
          openid: OPENID || ''
        });

        const openidsToMigrate = [];
        if (userInfo && userInfo._openid) openidsToMigrate.push(userInfo._openid);
        if (OPENID && (!userInfo || !userInfo._openid || userInfo._openid !== OPENID)) openidsToMigrate.push(OPENID);
        await migrateUserIdByOpenid({ userId: userInfo._id, openids: openidsToMigrate });

        const sessionToken = crypto.randomBytes(32).toString('hex');
        const tokenDigest = sha256Hex(sessionToken);
        const expireAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db.collection('sessions').where({ userId: userInfo._id }).remove();
        await db.collection('sessions').add({
          data: {
            tokenDigest,
            userId: userInfo._id,
            phone: normalizedPhone,
            createTime: now,
            expireAt
          }
        });

        const hasPassword = !!(userInfo && userInfo.passwordHash);
        return { success: true, token: sessionToken, userInfo, isNewUser, hasPassword, usedTestCode: true };
      }

      const codeRes = await db.collection('sms_codes')
        .where({
          phone: String(phone),
          expireAt: _.gt(now)
        })
        .orderBy('createTime', 'desc')
        .limit(1)
        .get();

      if (!codeRes.data || codeRes.data.length === 0) {
        return { success: false, message: '验证码已过期，请重新获取' };
      }

      const codeDoc = codeRes.data[0];
      const expectedHash = sha256Hex(String(codeDoc.salt || '') + normalizedCode);
      if (expectedHash !== codeDoc.codeHash) {
        return { success: false, message: '验证码不正确' };
      }

      await db.collection('sms_codes').where({ phone: String(phone) }).remove();

      const normalizedPhone = String(phone);
      const { userInfo, isNewUser } = await upsertUserByPhone({
        normalizedPhone,
        idCard,
        referralCodeInput,
        openid: OPENID || ''
      });

      const openidsToMigrate = [];
      if (userInfo && userInfo._openid) openidsToMigrate.push(userInfo._openid);
      if (OPENID && (!userInfo || !userInfo._openid || userInfo._openid !== OPENID)) openidsToMigrate.push(OPENID);
      await migrateUserIdByOpenid({ userId: userInfo._id, openids: openidsToMigrate });

      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenDigest = sha256Hex(sessionToken);
      const expireAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.collection('sessions').where({ userId: userInfo._id }).remove();
      await db.collection('sessions').add({
        data: {
          tokenDigest,
          userId: userInfo._id,
          phone: normalizedPhone,
          createTime: now,
          expireAt
        }
      });

      const hasPassword = !!(userInfo && userInfo.passwordHash);
      return { success: true, token: sessionToken, userInfo, isNewUser, hasPassword };
    }

    if (action === 'passwordRegister') {
      if (!isValidPhone(phone)) {
        return { success: false, message: '手机号格式不正确' };
      }
      if (!password || String(password).length < 6) {
        return { success: false, message: '密码至少 6 位' };
      }

      const normalizedPhone = String(phone);
      const existedRes = await db.collection('users').where({ phone: normalizedPhone }).limit(1).get();
      if (existedRes.data && existedRes.data.length > 0) {
        const existed = existedRes.data[0];
        if (existed && existed.passwordHash) {
          return { success: false, message: '该手机号已注册，请使用验证码登录' };
        }
      }

      const now = new Date();
      const { userInfo: baseUserInfo, isNewUser } = await upsertUserByPhone({
        normalizedPhone,
        idCard,
        referralCodeInput,
        openid: OPENID || ''
      });

      const salt = createSalt();
      const passwordHash = sha256Hex(salt + String(password));
      await db.collection('users').doc(baseUserInfo._id).update({
        data: {
          passwordSalt: salt,
          passwordHash,
          lastOpenid: OPENID || '',
          updateTime: now
        }
      });
      const userInfo = { ...baseUserInfo, passwordSalt: salt, passwordHash, lastOpenid: OPENID || '', updateTime: now };

      const openidsToMigrate = [];
      if (userInfo && userInfo._openid) openidsToMigrate.push(userInfo._openid);
      if (OPENID && (!userInfo._openid || userInfo._openid !== OPENID)) openidsToMigrate.push(OPENID);
      await migrateUserIdByOpenid({ userId: userInfo._id, openids: openidsToMigrate });

      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenDigest = sha256Hex(sessionToken);
      const expireAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.collection('sessions').where({ userId: userInfo._id }).remove();
      await db.collection('sessions').add({
        data: {
          tokenDigest,
          userId: userInfo._id,
          phone: normalizedPhone,
          createTime: now,
          expireAt
        }
      });

      return { success: true, token: sessionToken, userInfo, isNewUser, hasPassword: true };
    }

    if (action === 'passwordLogin') {
      if (!isValidPhone(phone)) {
        return { success: false, message: '手机号格式不正确' };
      }
      if (!password || String(password).length < 6) {
        return { success: false, message: '密码格式不正确' };
      }

      const userRes = await db.collection('users').where({ phone: String(phone) }).limit(1).get();
      if (!userRes.data || userRes.data.length === 0) {
        return { success: false, message: '账号不存在，请先验证码登录' };
      }

      const userInfo = userRes.data[0];
      if (!userInfo.passwordSalt || !userInfo.passwordHash) {
        return { success: false, message: '该账号未设置密码，请先验证码登录' };
      }

      const computed = sha256Hex(String(userInfo.passwordSalt) + String(password));
      if (computed !== userInfo.passwordHash) {
        return { success: false, message: '手机号或密码错误' };
      }

      const now = new Date();
      await db.collection('users').doc(userInfo._id).update({
        data: {
          lastOpenid: OPENID || '',
          updateTime: now
        }
      });

      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenDigest = sha256Hex(sessionToken);
      const expireAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.collection('sessions').where({ userId: userInfo._id }).remove();
      await db.collection('sessions').add({
        data: {
          tokenDigest,
          userId: userInfo._id,
          phone: String(phone),
          createTime: now,
          expireAt
        }
      });

      return { success: true, token: sessionToken, userInfo, isNewUser: false, hasPassword: true };
    }

    if (action === 'setPassword') {
      if (!password || String(password).length < 6) {
        return { success: false, message: '密码至少 6 位' };
      }
      const tokenDigest = sha256Hex(String(token || ''));
      const now = new Date();
      const sessRes = await db.collection('sessions').where({ tokenDigest, expireAt: _.gt(now) }).limit(1).get();
      if (!sessRes.data || sessRes.data.length === 0) {
        return { success: false, message: '请先登录' };
      }
      const sess = sessRes.data[0];

      const salt = createSalt();
      const passwordHash = sha256Hex(salt + String(password));
      await db.collection('users').doc(sess.userId).update({
        data: {
          passwordSalt: salt,
          passwordHash,
          updateTime: new Date()
        }
      });
      return { success: true };
    }
    if (action === 'logout') {
      const tokenDigest = sha256Hex(String(token || ''));
      await db.collection('sessions').where({ tokenDigest }).remove();
      return { success: true };
    }

    const tokenDigest = sha256Hex(String(token || ''));
    const now = new Date();
    const sessRes = await db.collection('sessions').where({ tokenDigest, expireAt: _.gt(now) }).limit(1).get();
    if (!sessRes.data || sessRes.data.length === 0) {
      return { success: false, needLogin: true };
    }

    const sess = sessRes.data[0];
    const userRes = await db.collection('users').doc(sess.userId).get();
    if (!userRes.data) {
      return { success: false, needLogin: true };
    }

    const userInfo = userRes.data;
    if (!userInfo.referralCode) {
      const selfReferralCode = String(userInfo._id || '').slice(-8);
      await db.collection('users').doc(userInfo._id).update({
        data: {
          referralCode: selfReferralCode,
          updateTime: now
        }
      });
      userInfo.referralCode = selfReferralCode;
    }

    return { success: true, userInfo };
  } catch (err) {
    const msg = String(err && (err.message || err.errMsg || err.errmsg || err));
    if (msg.includes('sessions') && (msg.includes('collection not exists') || msg.includes('Db or Table not exist') || msg.includes('-502005'))) {
      return { success: false, message: '数据库缺少 sessions 集合，请在云开发控制台创建 sessions' };
    }
    if (msg.includes('sms_codes') && (msg.includes('collection not exists') || msg.includes('Db or Table not exist') || msg.includes('-502005'))) {
      return { success: false, message: '数据库缺少 sms_codes 集合，请在云开发控制台创建 sms_codes' };
    }
    console.error('登录失败', err);
    return {
      success: false,
      message: err.message
    };
  }
};

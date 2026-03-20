// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

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
    const { phone, idCard } = event;

    try {
      // 查询用户是否已存在
      const userRes = await db.collection('users')
        .where({
          _openid: OPENID
        })
        .get();

      let userInfo;

      if (userRes.data.length > 0) {
        // 用户已存在
        userInfo = userRes.data[0];

        // 如果提供了手机号或身份证，更新等级
        if (phone || idCard) {
          const level = await getUserLevelFromSystem(phone, idCard);
          if (level !== userInfo.level) {
            await db.collection('users').doc(userInfo._id).update({
              data: {
                level,
                phone: phone || userInfo.phone,
                idCard: idCard || userInfo.idCard,
                updateTime: new Date()
              }
            });
            userInfo.level = level;
            if (phone) userInfo.phone = phone;
            if (idCard) userInfo.idCard = idCard;
          }
        }
      } else {
        // 新用户，检查是否有注册记录
        let registerInfo = null;
        const registerRes = await db.collection('register')
          .where({
            openid: OPENID
          })
          .get();

        if (registerRes.data.length > 0) {
          // 有注册记录，使用注册信息
          registerInfo = registerRes.data[0];
        } else if (phone) {
          // 没有注册记录，但有手机号，根据手机号查询注册记录
          const phoneRegisterRes = await db.collection('register')
            .where({
              phone: phone
            })
            .get();
          if (phoneRegisterRes.data.length > 0) {
            registerInfo = phoneRegisterRes.data[0];
          }
        }

        // 新用户，创建用户记录
        const now = new Date();

        // 根据手机号或身份证匹配等级
        const level = await getUserLevelFromSystem(registerInfo?.phone || phone, registerInfo?.idCard || idCard);

        const newUser = {
          _openid: OPENID, // 强制写入 openid
          name: registerInfo?.name || '学员' + OPENID.slice(-6),
          avatar: '',
          phone: registerInfo?.phone || phone || '',
          idCard: registerInfo?.idCard || idCard || '',
          school: registerInfo?.school || '',
          company: registerInfo?.company || '',
          position: registerInfo?.position || '',
          workYears: registerInfo?.workYears || '',
          isTrained: registerInfo?.isTrained || 0,
          recommendCode: registerInfo?.recommendCode || '',
          level: level,
          points: 0,
          totalPoints: 0,
          createTime: now,
          updateTime: now
        };

        const addRes = await db.collection('users').add({
          data: newUser
        });

        userInfo = {
          _id: addRes._id,
          ...newUser
        };
      }

      return {
        success: true,
        openid: OPENID,
        userInfo
      };
    } catch (err) {
      console.error('登录失败', err);
      return {
        success: false,
        message: err.message
      };
    }
  };
}

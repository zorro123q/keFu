// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const { OPENID } = wxContext;

  try {
    // 查询用户信息
    const userRes = await db.collection('users')
      .where({
        _openid: OPENID
      })
      .get();

    if (userRes.data.length === 0) {
      return {
        success: false,
        message: '用户不存在'
      };
    }

    const user = userRes.data[0];

    return {
      success: true,
      points: user.points,
      totalPoints: user.totalPoints,
      level: user.level
    };
  } catch (err) {
    console.error('获取积分失败', err);
    return {
      success: false,
      message: err.message
    };
  }
};

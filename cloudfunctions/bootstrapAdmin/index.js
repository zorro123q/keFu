const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const inputOpenid = event && (event.openid || event.OPENID);
  const openid = OPENID || inputOpenid;
  const now = new Date();

  try {
    if (!openid) {
      return { success: false, message: '云端测试拿不到登录态，请在参数里传 openid' };
    }

    // 仅当 admins 集合为空时，允许写入首个管理员
    const countRes = await db.collection('admins').count();
    if ((countRes.total || 0) === 0) {
      await db.collection('admins').add({
        data: {
          openid: openid,
          role: 'super',
          createTime: now
        }
      });
      return { success: true, message: '已初始化首个管理员', openid: openid };
    }

    // 非空时，如当前用户已是管理员，返回提示；否则拒绝
    const existsRes = await db.collection('admins').where({
      openid: openid
    }).count();

    if ((existsRes.total || 0) > 0) {
      return { success: true, message: '当前账号已是管理员', openid: openid };
    }

    return { success: false, message: '已存在管理员，请由现有管理员添加新管理员' };
  } catch (err) {
    console.error('bootstrap admin failed', err);
    return { success: false, message: err.message || 'failed' };
  }
};

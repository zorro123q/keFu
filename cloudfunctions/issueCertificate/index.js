// a new cloud function for issuing certificates.
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

// a main function
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { userId, certName, level } = event;

  if (!userId || !certName || !level) {
    return {
      success: false,
      message: '缺少必要参数（userId, certName, level）'
    };
  }

  try {
    await db.collection('certificates').add({
      data: {
        _openid: OPENID, // 证书所有者的openid
        userId: userId, // 关联的用户ID
        certName: certName, // 证书名称
        level: level, // 证书等级
        issueDate: new Date() // 证书颁发日期
      }
    });

    return {
      success: true,
      message: '证书颁发成功'
    };
  } catch (e) {
    console.error('证书颁发失败', e);
    return {
      success: false,
      message: '数据库写入失败'
    };
  }
};

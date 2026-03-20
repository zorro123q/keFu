// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const { OPENID } = wxContext;
  const formData = event;

  try {
    // 基础校验
    const requiredFields = ['name', 'phone', 'school', 'company', 'position', 'workYears'];
    for (const field of requiredFields) {
      if (!formData[field]) {
        return {
          success: false,
          message: `请填写${getFieldName(field)}`
        };
      }
    }

    // 校验手机号格式
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(formData.phone)) {
      return {
        success: false,
        message: '手机号格式不正确'
      };
    }

    // 校验工作年限
    if (isNaN(formData.workYears) || formData.workYears < 0) {
      return {
        success: false,
        message: '工作年限格式不正确'
      };
    }

    // 校验身份证格式（如果填写）
    if (formData.idCard) {
      const idCardRegex = /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/;
      if (!idCardRegex.test(formData.idCard)) {
        return {
          success: false,
          message: '身份证格式不正确'
        };
      }
    }

    // 检查手机号是否已注册
    const existingUser = await db.collection('register')
      .where({ phone: formData.phone })
      .get();

    if (existingUser.data.length > 0) {
      return {
        success: false,
        message: '手机号已注册'
      };
    }

    // 准备数据
    const registerData = {
      ...formData,
      openid: OPENID,
      createTime: new Date(),
      // 将学历和是否参训转换为字符串
      education: formData.education !== undefined ? formData.education : 0,
      isTrained: formData.isTrained !== undefined ? formData.isTrained : 0
    };

    // 写入数据库
    const result = await db.collection('register').add({
      data: registerData
    });

    return {
      success: true,
      message: '注册成功',
      data: {
        _id: result._id
      }
    };
  } catch (err) {
    console.error('注册失败', err);
    return {
      success: false,
      message: '服务器错误，请稍后重试'
    };
  }
};

// 获取字段名称
function getFieldName(field) {
  const fieldNames = {
    name: '姓名',
    phone: '手机号',
    school: '学校',
    company: '公司',
    position: '岗位',
    workYears: '工作年限'
  };
  return fieldNames[field] || field;
}
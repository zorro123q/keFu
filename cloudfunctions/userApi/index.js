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
  let sessRes;
  try {
    sessRes = await db.collection('sessions').where({ tokenDigest, expireAt: _.gt(now) }).limit(1).get();
  } catch (e) {
    const msg = String(e && (e.message || e.errMsg || e.errmsg || e));
    if (msg.includes('sessions') && (msg.includes('collection not exists') || msg.includes('Db or Table not exist') || msg.includes('-502005'))) {
      const err = new Error('数据库缺少 sessions 集合，请先在云开发控制台创建 sessions');
      err.code = 'NEED_SETUP';
      throw err;
    }
    throw e;
  }

  if (!sessRes.data || sessRes.data.length === 0) {
    const err = new Error('NEED_LOGIN');
    err.code = 'NEED_LOGIN';
    throw err;
  }
  return sessRes.data[0];
}

function parseAdminPhones() {
  const raw = String(process.env.ADMIN_PHONES || '').trim();
  if (!raw) return [];
  return raw
    .split(/[\s,;，；]+/g)
    .map(s => String(s || '').trim())
    .filter(Boolean);
}

function isAdminPhone(phone) {
  const p = String(phone || '').trim();
  if (!p) return false;
  const list = parseAdminPhones();
  if (list.length === 0) return false;
  return list.includes(p);
}

function toCertLevelNumber(input) {
  const n = Number(input);
  if (n === 1 || n === 2 || n === 3) return n;
  const s = String(input || '').trim();
  if (s === '初级') return 1;
  if (s === '中级') return 2;
  if (s === '高级') return 3;
  return 0;
}

exports.main = async (event) => {
  const { action = '' } = event || {};
  const token = event && event.token;

  try {
    const sess = await requireSession(token);
    const userId = sess.userId;

    if (action === 'getUserInfo') {
      const userRes = await db.collection('users').doc(userId).get();
      return { success: true, data: userRes.data || null };
    }

    if (action === 'getPointsLogs') {
      const { type, page = 1, pageSize = 20 } = event || {};
      const size = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
      const currentPage = Math.max(parseInt(page, 10) || 1, 1);
      let query = db.collection('points_logs').where({ userId });
      if (type) query = query.where({ userId, type });
      const res = await query
        .orderBy('createTime', 'desc')
        .skip((currentPage - 1) * size)
        .limit(size)
        .get();
      return { success: true, data: res.data || [] };
    }

    if (action === 'getOrders') {
      const { status, page = 1, pageSize = 20 } = event || {};
      const size = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
      const currentPage = Math.max(parseInt(page, 10) || 1, 1);
      const where = { userId };
      if (status) where.status = status;
      const res = await db.collection('orders')
        .where(where)
        .orderBy('createTime', 'desc')
        .skip((currentPage - 1) * size)
        .limit(size)
        .get();
      return { success: true, data: res.data || [] };
    }

    if (action === 'getOrderDetail') {
      const { id } = event || {};
      if (!id) return { success: false, message: '参数错误' };
      const res = await db.collection('orders').doc(id).get();
      const order = res.data;
      if (!order || order.userId !== userId) return { success: false, message: '订单不存在' };
      return { success: true, data: order };
    }

    if (action === 'getAddresses') {
      const res = await db.collection('addresses')
        .where({ userId })
        .orderBy('isDefault', 'desc')
        .orderBy('createTime', 'desc')
        .get();
      return { success: true, data: res.data || [] };
    }

    if (action === 'getDefaultAddress') {
      const res = await db.collection('addresses')
        .where({ userId, isDefault: true })
        .limit(1)
        .get();
      return { success: true, data: (res.data && res.data[0]) ? res.data[0] : null };
    }

    if (action === 'addAddress') {
      const { data } = event || {};
      if (!data) return { success: false, message: '参数错误' };
      const now = new Date();
      const isDefault = !!data.isDefault;

      const transaction = await db.startTransaction();
      try {
        if (isDefault) {
          await transaction.collection('addresses').where({ userId, isDefault: true }).update({ data: { isDefault: false, updateTime: now } });
        }
        const addRes = await transaction.collection('addresses').add({
          data: {
            ...data,
            userId,
            isDefault,
            createTime: now,
            updateTime: now
          }
        });
        await transaction.commit();
        return { success: true, data: { _id: addRes._id } };
      } catch (e) {
        await transaction.rollback();
        throw e;
      }
    }

    if (action === 'updateAddress') {
      const { id, data } = event || {};
      if (!id || !data) return { success: false, message: '参数错误' };
      const now = new Date();
      const addressRes = await db.collection('addresses').doc(id).get();
      const address = addressRes.data;
      if (!address || address.userId !== userId) return { success: false, message: '地址不存在' };

      const isDefault = typeof data.isDefault === 'boolean' ? data.isDefault : address.isDefault;
      const transaction = await db.startTransaction();
      try {
        if (isDefault) {
          await transaction.collection('addresses').where({ userId, isDefault: true }).update({ data: { isDefault: false, updateTime: now } });
        }
        await transaction.collection('addresses').doc(id).update({
          data: {
            ...data,
            isDefault,
            updateTime: now
          }
        });
        await transaction.commit();
        return { success: true };
      } catch (e) {
        await transaction.rollback();
        throw e;
      }
    }

    if (action === 'deleteAddress') {
      const { id } = event || {};
      if (!id) return { success: false, message: '参数错误' };
      const addressRes = await db.collection('addresses').doc(id).get();
      const address = addressRes.data;
      if (!address || address.userId !== userId) return { success: false, message: '地址不存在' };
      await db.collection('addresses').doc(id).remove();
      return { success: true };
    }

    if (action === 'updateUserProfile') {
      const { data } = event || {};
      if (!data) return { success: false, message: '参数错误' };
      await db.collection('users').doc(userId).update({
        data: {
          ...data,
          updateTime: new Date()
        }
      });
      const userRes = await db.collection('users').doc(userId).get();
      return { success: true, data: userRes.data || null };
    }

    if (action === 'getPasswordStatus') {
      const userRes = await db.collection('users').doc(userId).get();
      const user = userRes.data;
      return { success: true, hasPassword: !!(user && user.passwordHash) };
    }

    if (action === 'getCertificates') {
      const res = await db.collection('certificates')
        .where({ userId, status: 'issued' })
        .orderBy('createTime', 'desc')
        .get();
      return { success: true, data: res.data || [] };
    }

    if (action === 'getUploadedCertificates') {
      const res = await db.collection('certificates')
        .where({ userId, status: 'uploaded' })
        .orderBy('createTime', 'desc')
        .get();
      return { success: true, data: res.data || [] };
    }

    if (action === 'uploadCertificate') {
      const fileID = String((event && (event.fileID || event.fileId || event.fileID)) || '').trim();
      if (!fileID) return { success: false, message: '缺少文件ID' };
      const now = new Date();
      const addRes = await db.collection('certificates').add({
        data: {
          userId,
          certName: '学员上传证书',
          level: 0,
          status: 'uploaded',
          source: 'user',
          imageFileID: fileID,
          createTime: now
        }
      });
      return { success: true, data: { _id: addRes._id } };
    }

    if (action === 'deleteUploadedCertificate') {
      const { id } = event || {};
      if (!id) return { success: false, message: '参数错误' };
      const certRes = await db.collection('certificates').doc(String(id)).get();
      const cert = certRes.data;
      if (!cert || cert.userId !== userId) return { success: false, message: '记录不存在' };
      if (cert.status !== 'uploaded') return { success: false, message: '仅支持删除已上传记录' };

      const fileID = String(cert.imageFileID || '').trim();
      if (fileID) {
        try {
          await cloud.deleteFile({ fileList: [fileID] });
        } catch (_) { }
      }
      await db.collection('certificates').doc(String(id)).remove();
      return { success: true };
    }

    if (action === 'adminGetUserCertificates') {
      if (!isAdminPhone(sess.phone)) {
        return { success: false, message: '无管理员权限', code: 'NO_PERMISSION' };
      }
      const targetUserId = String((event && event.userId) || '').trim();
      if (!targetUserId) return { success: false, message: '参数错误' };
      const res = await db.collection('certificates')
        .where({ userId: targetUserId })
        .orderBy('createTime', 'desc')
        .get();
      return { success: true, data: res.data || [] };
    }

    if (action === 'adminIssueCertificate') {
      if (!isAdminPhone(sess.phone)) {
        return { success: false, message: '无管理员权限', code: 'NO_PERMISSION' };
      }
      const targetUserId = String((event && event.userId) || '').trim();
      const level = toCertLevelNumber(event && event.level);
      const certName = String((event && event.certName) || '').trim() || (level === 3 ? '高级训机师证书' : level === 2 ? '中级训机师证书' : '初级训机师证书');
      if (!targetUserId || !level) return { success: false, message: '参数错误' };

      const now = new Date();
      const addRes = await db.collection('certificates').add({
        data: {
          userId: targetUserId,
          certName,
          level,
          status: 'issued',
          source: 'admin',
          operatorId: userId,
          issueDate: now,
          createTime: now
        }
      });
      return { success: true, data: { _id: addRes._id } };
    }

    if (action === 'adminListCategories') {
      if (!isAdminPhone(sess.phone)) {
        return { success: false, message: '无管理员权限', code: 'NO_PERMISSION' };
      }
      const res = await db.collection('categories')
        .orderBy('sort', 'asc')
        .orderBy('createTime', 'desc')
        .get();
      return { success: true, data: res.data || [] };
    }

    if (action === 'adminUpsertCategory') {
      if (!isAdminPhone(sess.phone)) {
        return { success: false, message: '无管理员权限', code: 'NO_PERMISSION' };
      }
      const { id, data } = event || {};
      if (!data) return { success: false, message: '参数错误' };
      const now = new Date();
      const payload = {
        name: String(data.name || '').trim(),
        icon: String(data.icon || '').trim(),
        sort: Number(data.sort || 0),
        status: String(data.status || 'on')
      };
      if (!payload.name) return { success: false, message: '分类名称不能为空' };
      if (payload.status !== 'on' && payload.status !== 'off') payload.status = 'on';

      if (id) {
        await db.collection('categories').doc(String(id)).update({ data: { ...payload, updateTime: now } });
        return { success: true };
      }
      const addRes = await db.collection('categories').add({
        data: {
          ...payload,
          createTime: now,
          updateTime: now
        }
      });
      return { success: true, data: { _id: addRes._id } };
    }

    if (action === 'adminDeleteCategory') {
      if (!isAdminPhone(sess.phone)) {
        return { success: false, message: '无管理员权限', code: 'NO_PERMISSION' };
      }
      const { id } = event || {};
      if (!id) return { success: false, message: '参数错误' };
      await db.collection('categories').doc(String(id)).remove();
      return { success: true };
    }

    if (action === 'adminListGoods') {
      if (!isAdminPhone(sess.phone)) {
        return { success: false, message: '无管理员权限', code: 'NO_PERMISSION' };
      }
      const { page = 1, pageSize = 20, keyword, status, category } = event || {};
      const size = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
      const currentPage = Math.max(parseInt(page, 10) || 1, 1);
      const where = {};
      const statusValue = String(status || '').trim();
      const categoryValue = String(category || '').trim();
      if (statusValue) where.status = statusValue;
      if (categoryValue) where.category = categoryValue;
      const kw = String(keyword || '').trim();
      if (kw) {
        where.name = db.RegExp({
          regexp: kw,
          options: 'i'
        });
      }

      const res = await db.collection('goods')
        .where(where)
        .orderBy('sort', 'asc')
        .orderBy('createTime', 'desc')
        .skip((currentPage - 1) * size)
        .limit(size)
        .get();
      return { success: true, data: res.data || [] };
    }

    if (action === 'adminUpsertGoods') {
      if (!isAdminPhone(sess.phone)) {
        return { success: false, message: '无管理员权限', code: 'NO_PERMISSION' };
      }
      const { id, data } = event || {};
      if (!data) return { success: false, message: '参数错误' };
      const now = new Date();
      const images = Array.isArray(data.images) ? data.images : (data.imageUrl ? [data.imageUrl] : []);
      const payload = {
        name: String(data.name || '').trim(),
        category: String(data.category || '').trim(),
        status: String(data.status || 'on'),
        sort: Number(data.sort || 0),
        points: Number(data.points || 0),
        stock: Number(data.stock || 0),
        images: images.filter(Boolean).map(s => String(s).trim()).filter(Boolean)
      };
      if (!payload.name) return { success: false, message: '商品名称不能为空' };
      if (payload.status !== 'on' && payload.status !== 'off') payload.status = 'on';
      if (!Number.isFinite(payload.points) || payload.points < 0) payload.points = 0;
      if (!Number.isFinite(payload.stock) || payload.stock < 0) payload.stock = 0;

      if (id) {
        await db.collection('goods').doc(String(id)).update({ data: { ...payload, updateTime: now } });
        return { success: true };
      }
      const addRes = await db.collection('goods').add({
        data: {
          ...payload,
          sold: 0,
          createTime: now,
          updateTime: now
        }
      });
      return { success: true, data: { _id: addRes._id } };
    }

    if (action === 'adminDeleteGoods') {
      if (!isAdminPhone(sess.phone)) {
        return { success: false, message: '无管理员权限', code: 'NO_PERMISSION' };
      }
      const { id } = event || {};
      if (!id) return { success: false, message: '参数错误' };
      await db.collection('goods').doc(String(id)).remove();
      return { success: true };
    }

    if (action === 'adminListPointsLogs') {
      if (!isAdminPhone(sess.phone)) {
        return { success: false, message: '无管理员权限', code: 'NO_PERMISSION' };
      }
      const { page = 1, pageSize = 20, type, keyword } = event || {};
      const size = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
      const currentPage = Math.max(parseInt(page, 10) || 1, 1);
      const where = {};
      const t = String(type || '').trim();
      if (t) where.type = t;

      const kw = String(keyword || '').trim();
      if (kw) {
        let userIds = [];
        if (/^[a-fA-F0-9]{24}$/.test(kw)) {
          userIds = [kw];
        } else {
          const reg = db.RegExp({
            regexp: kw,
            options: 'i'
          });
          const uRes = await db.collection('users')
            .where(_.or([{ phone: reg }, { name: reg }]))
            .limit(50)
            .get();
          userIds = (uRes.data || []).map(u => u._id).filter(Boolean);
        }
        if (userIds.length === 0) return { success: true, data: [] };
        where.userId = _.in(userIds.slice(0, 50));
      }

      const logsRes = await db.collection('points_logs')
        .where(where)
        .orderBy('createTime', 'desc')
        .skip((currentPage - 1) * size)
        .limit(size)
        .get();

      const logs = logsRes.data || [];
      const ids = Array.from(new Set(logs.map(l => l.userId).filter(Boolean)));
      let userMap = {};
      if (ids.length > 0) {
        const uRes = await db.collection('users')
          .where({ _id: _.in(ids.slice(0, 50)) })
          .field({ name: true, phone: true, avatar: true, level: true })
          .get();
        userMap = {};
        (uRes.data || []).forEach(u => {
          userMap[u._id] = u;
        });
      }

      const data = logs.map(l => {
        const u = userMap[l.userId] || {};
        return {
          ...l,
          userName: u.name || '',
          userPhone: u.phone || '',
          userAvatar: u.avatar || '',
          userLevel: u.level || ''
        };
      });
      return { success: true, data };
    }

    if (action === 'adminListOrders') {
      if (!isAdminPhone(sess.phone)) {
        return { success: false, message: '无管理员权限', code: 'NO_PERMISSION' };
      }
      const { page = 1, pageSize = 20, status, keyword } = event || {};
      const size = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
      const currentPage = Math.max(parseInt(page, 10) || 1, 1);
      const baseWhere = {};
      const st = String(status || '').trim();
      if (st) baseWhere.status = st;

      const kw = String(keyword || '').trim();
      let queryWhere = baseWhere;
      if (kw) {
        const or = [];
        or.push({ orderNo: db.RegExp({ regexp: kw, options: 'i' }) });
        or.push({ exchangeCode: db.RegExp({ regexp: kw, options: 'i' }) });
        or.push({ goodsName: db.RegExp({ regexp: kw, options: 'i' }) });

        let userIds = [];
        if (/^[a-fA-F0-9]{24}$/.test(kw)) {
          userIds = [kw];
        } else {
          const reg = db.RegExp({ regexp: kw, options: 'i' });
          const uRes = await db.collection('users')
            .where(_.or([{ phone: reg }, { name: reg }]))
            .limit(50)
            .get();
          userIds = (uRes.data || []).map(u => u._id).filter(Boolean);
        }
        if (userIds.length > 0) {
          or.push({ userId: _.in(userIds.slice(0, 50)) });
        }
        const orWhere = _.or(or);
        if (Object.keys(baseWhere).length > 0) {
          queryWhere = _.and([baseWhere, orWhere]);
        } else {
          queryWhere = orWhere;
        }
      }

      const res = await db.collection('orders')
        .where(queryWhere)
        .orderBy('createTime', 'desc')
        .skip((currentPage - 1) * size)
        .limit(size)
        .get();
      const rows = res.data || [];
      const ids = Array.from(new Set(rows.map(o => o.userId).filter(Boolean)));
      let userMap = {};
      if (ids.length > 0) {
        const uRes = await db.collection('users')
          .where({ _id: _.in(ids.slice(0, 50)) })
          .field({ name: true, phone: true, avatar: true, level: true })
          .get();
        userMap = {};
        (uRes.data || []).forEach(u => { userMap[u._id] = u; });
      }
      const data = rows.map(o => {
        const u = userMap[o.userId] || {};
        return {
          ...o,
          userName: u.name || '',
          userPhone: u.phone || '',
          userAvatar: u.avatar || '',
          userLevel: u.level || ''
        };
      });
      return { success: true, data };
    }

    if (action === 'adminUpdateOrder') {
      if (!isAdminPhone(sess.phone)) {
        return { success: false, message: '无管理员权限', code: 'NO_PERMISSION' };
      }
      const { id, data } = event || {};
      const orderId = String(id || '').trim();
      if (!orderId) return { success: false, message: '参数错误' };
      const payload = data || {};
      const now = new Date();

      const orderRes = await db.collection('orders').doc(orderId).get();
      const order = orderRes.data;
      if (!order) return { success: false, message: '订单不存在' };

      const nextStatus = String(payload.status || '').trim();
      const nextExpressCompany = String(payload.expressCompany || '').trim();
      const nextExpressNo = String(payload.expressNo || '').trim();

      const updateData = { updateTime: now };

      if (nextStatus) {
        const allowed = ['pending', 'shipped', 'completed', 'cancelled'];
        if (!allowed.includes(nextStatus)) return { success: false, message: '状态不合法' };
        if (order.status === 'completed') return { success: false, message: '订单已完成' };
        if (nextStatus === 'completed' && order.status === 'pending') return { success: false, message: '请先发货' };
        if (nextStatus === 'shipped' && order.status !== 'pending') return { success: false, message: '当前状态不可发货' };
        if (nextStatus === 'completed' && order.status !== 'shipped') return { success: false, message: '当前状态不可完成' };
        if (nextStatus === 'cancelled' && order.status === 'cancelled') return { success: false, message: '订单已取消' };

        updateData.status = nextStatus;
        if (nextStatus === 'shipped') updateData.shippedTime = now;
        if (nextStatus === 'completed') updateData.completedTime = now;
        if (nextStatus === 'cancelled') updateData.cancelTime = now;
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'expressCompany')) {
        updateData.expressCompany = nextExpressCompany;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'expressNo')) {
        updateData.expressNo = nextExpressNo;
      }

      await db.collection('orders').doc(orderId).update({ data: updateData });
      const updated = await db.collection('orders').doc(orderId).get();
      return { success: true, data: updated.data || null };
    }

    if (action === 'backfillPointsLogsIfMissing') {
      const userRes = await db.collection('users').doc(userId).get();
      const user = userRes.data;
      if (!user) return { success: false, message: '用户不存在' };
      const logsCountRes = await db.collection('points_logs').where({ userId }).count();
      const count = logsCountRes.total || 0;
      if (count > 0) {
        return { success: true, backfilled: false };
      }
      const now = new Date();
      const initialAmount = Number(user.totalPoints || user.points || 0);
      if (initialAmount <= 0) {
        return { success: true, backfilled: false };
      }
      await db.collection('points_logs').add({
        data: {
          userId,
          type: 'earn',
          amount: initialAmount,
          balance: Number(user.points || initialAmount),
          reason: '初始化积分（历史无明细）',
          createTime: now
        }
      });
      return { success: true, backfilled: true };
    }

    return { success: false, message: 'unknown action' };
  } catch (err) {
    return { success: false, message: err.message || 'failed', code: err.code || '' };
  }
};

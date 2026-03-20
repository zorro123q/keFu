const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function httpsRequest({ method, url, headers, body, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const baseHeaders = {
      'User-Agent': 'CloudBaseFunction/1.0',
      'Accept': '*/*'
    };
    const mergedHeaders = { ...baseHeaders, ...(headers || {}) };
    if (body && mergedHeaders['Content-Length'] === undefined) {
      mergedHeaders['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(url, { method, headers: mergedHeaders }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        buffer: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('request timeout'));
    });
    if (body) req.write(body);
    req.end();
  });
}

function bufferToSnippet(buf, maxLen = 200) {
  try {
    const s = buf.toString('utf8');
    return s.length > maxLen ? s.slice(0, maxLen) + '...' : s;
  } catch (_) {
    return '';
  }
}

async function getAccessToken() {
  const appid = process.env.WX_APPID;
  const secret = process.env.WX_APPSECRET;
  if (!appid || !secret) {
    throw new Error('缺少环境变量 WX_APPID / WX_APPSECRET');
  }

  const docId = 'wx_access_token';
  const now = Date.now();

  try {
    const cache = await db.collection('wx_cache').doc(docId).get();
    const data = cache && cache.data;
    if (data && data.token && data.expiresAt && now < Number(data.expiresAt) - 5 * 60 * 1000) {
      return data.token;
    }
  } catch (_) { }

  const tokenUrl = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`;
  const tokenRes = await httpsRequest({ method: 'GET', url: tokenUrl });
  let json = null;
  try {
    json = JSON.parse(tokenRes.buffer.toString('utf8'));
  } catch (_) {
    throw new Error(`获取access_token失败：${tokenRes.statusCode} ${bufferToSnippet(tokenRes.buffer)}`);
  }

  if (!json || !json.access_token) {
    const msg = json && (json.errmsg || json.error || json.message) ? (json.errmsg || json.error || json.message) : '获取access_token失败';
    throw new Error(msg);
  }

  const token = json.access_token;
  const expiresIn = Number(json.expires_in || 0);
  const expiresAt = now + Math.max(expiresIn, 60) * 1000;

  try {
    await db.collection('wx_cache').doc(docId).set({
      data: {
        token,
        expiresAt,
        updateTime: new Date()
      }
    });
  } catch (_) { }

  return token;
}

exports.main = async (event, context) => {
  const {
    referralCode = '',
    page = '',
    width = 430,
    autoColor = false,
    isHyaline = false,
    returnType = 'file'
  } = event || {};

  const sceneRaw = String(referralCode || '').trim();
  if (!sceneRaw) {
    return { success: false, message: '缺少 referralCode' };
  }

  const scene = `rc=${sceneRaw}`.slice(0, 32);

  try {
    const accessToken = await getAccessToken();
    const apiUrl = `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(accessToken)}`;
    const normalizedPage = String(page || '').trim().replace(/^\//, '');
    const makeBody = (usePage) => {
      const bodyObj = { scene, width, auto_color: autoColor, is_hyaline: isHyaline };
      if (usePage && normalizedPage) bodyObj.page = normalizedPage;
      return Buffer.from(JSON.stringify(bodyObj));
    };

    const callWxApi = async (usePage) => {
      return httpsRequest({
        method: 'POST',
        url: apiUrl,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: makeBody(usePage)
      });
    };

    let postRes = await callWxApi(true);

    const buffer = postRes && postRes.buffer;
    if (!buffer) {
      return { success: false, message: '生成失败' };
    }

    const ct = (postRes.headers && (postRes.headers['content-type'] || postRes.headers['Content-Type'])) || '';
    const looksJson = String(ct).includes('application/json') || buffer.slice(0, 1).toString('utf8') === '{';
    if (postRes.statusCode && postRes.statusCode !== 200) {
      const snippet = bufferToSnippet(buffer);
      return { success: false, message: `生成失败：${postRes.statusCode} ct=${ct || '-'} ${snippet || '<empty>'}` };
    }

    if (looksJson) {
      try {
        const errJson = JSON.parse(buffer.toString('utf8'));
        if (errJson && errJson.errcode) {
          const msg = String(errJson.errmsg || '');
          if (msg.includes('invalid page')) {
            postRes = await callWxApi(false);
            const retryBuffer = postRes && postRes.buffer;
            if (!retryBuffer) return { success: false, message: '生成失败' };
            const retryCt = (postRes.headers && (postRes.headers['content-type'] || postRes.headers['Content-Type'])) || '';
            if (postRes.statusCode && postRes.statusCode !== 200) {
              const snippet = bufferToSnippet(retryBuffer);
              return { success: false, message: `生成失败：${postRes.statusCode} ct=${retryCt || '-'} ${snippet || '<empty>'}` };
            }
            const retryLooksJson = String(retryCt).includes('application/json') || retryBuffer.slice(0, 1).toString('utf8') === '{';
            if (retryLooksJson) {
              const retryJson = JSON.parse(retryBuffer.toString('utf8'));
              if (retryJson && retryJson.errcode) {
                return { success: false, message: retryJson.errmsg || '生成失败' };
              }
            }
          }
          return { success: false, message: errJson.errmsg || '生成失败' };
        }
      } catch (_) {
        return { success: false, message: `生成失败：${bufferToSnippet(buffer)}` };
      }
    }

    const finalBuffer = postRes && postRes.buffer ? postRes.buffer : buffer;

    const isPng = finalBuffer.length >= 8 && finalBuffer[0] === 0x89 && finalBuffer[1] === 0x50 && finalBuffer[2] === 0x4E && finalBuffer[3] === 0x47 && finalBuffer[4] === 0x0D && finalBuffer[5] === 0x0A && finalBuffer[6] === 0x1A && finalBuffer[7] === 0x0A;
    const isJpg = finalBuffer.length >= 2 && finalBuffer[0] === 0xFF && finalBuffer[1] === 0xD8;
    if (!isPng && !isJpg) {
      return { success: false, message: `生成失败（返回非图片内容）：${bufferToSnippet(finalBuffer)}` };
    }

    if (returnType === 'base64') {
      return {
        success: true,
        scene,
        contentType: 'image/png',
        base64: finalBuffer.toString('base64')
      };
    }

    const hash = crypto.createHash('md5').update(`${scene}|${page}|${width}|${autoColor}|${isHyaline}`).digest('hex');
    const cloudPath = `qrcodes/${hash}_${Date.now()}.png`;
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: finalBuffer
    });

    const fileID = uploadRes && uploadRes.fileID;
    if (!fileID) {
      return { success: false, message: '上传失败' };
    }

    const urlRes = await cloud.getTempFileURL({
      fileList: [fileID]
    });

    const tempFileURL = urlRes && urlRes.fileList && urlRes.fileList[0] ? urlRes.fileList[0].tempFileURL : '';

    return {
      success: true,
      scene,
      fileID,
      tempFileURL
    };
  } catch (err) {
    return { success: false, message: err.message || '生成失败' };
  }
};

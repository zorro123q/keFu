# 数据库初始化指南

## 1. 开通云开发

1. 在微信开发者工具中打开项目
2. 点击工具栏的「云开发」按钮
3. 按照提示开通云开发环境
4. 记录云开发环境 ID

## 2. 修改云环境 ID

打开 `miniprogram/app.js`，修改云开发环境 ID：

```javascript
wx.cloud.init({
  env: 'your-env-id', // 替换为你的云开发环境ID
  traceUser: true
});
```

## 3. 创建数据库集合

在云开发控制台 -> 数据库 -> 集合管理，创建以下集合：

- `users` - 学员表
- `levels` - 等级配置表
- `level_mappings` - 等级映射表（手机号/身份证与等级的映射）
- `points_logs` - 积分明细表
- `goods` - 商品表
- `categories` - 商品分类表
- `orders` - 订单表
- `addresses` - 地址表
- `notices` - 公告表
- `admins` - 管理员表

## 4. 设置数据库权限

为每个集合设置权限：

- `users`: 仅创建者可读写
- `points_logs`: 仅创建者可读写
- `orders`: 仅创建者可读写
- `addresses`: 仅创建者可读写
- `levels`: 所有用户可读，仅管理员可写
- `level_mappings`: 仅管理员可读写
- `goods`: 所有用户可读，仅管理员可写
- `categories`: 所有用户可读，仅管理员可写
- `notices`: 所有用户可读，仅管理员可写
- `admins`: 仅管理员可读写

## 5. 导入初始数据

### 5.1 等级配置 (levels)

```json
[
  {
    "key": "junior",
    "name": "初级训机师",
    "privileges": ["基础兑换权益"],
    "color": "#52c41a",
    "createTime": {"$date": "2024-01-01T00:00:00.000Z"}
  },
  {
    "key": "intermediate",
    "name": "中级训机师",
    "privileges": ["基础兑换权益", "专属商品折扣"],
    "color": "#faad14",
    "createTime": {"$date": "2024-01-01T00:00:00.000Z"}
  },
  {
    "key": "senior",
    "name": "高级训机师",
    "privileges": ["基础兑换权益", "专属商品折扣", "VIP专属商品", "优先兑换权"],
    "color": "#f5222d",
    "createTime": {"$date": "2024-01-01T00:00:00.000Z"}
  }
]
```

### 5.2 等级映射表 (level_mappings)

重要：等级通过手机号或身份证号码从系统数据库匹配，与积分数量独立。

```json
[
  {
    "phone": "13800138001",
    "idCard": "",
    "level": "junior",
    "createTime": {"$date": "2024-01-01T00:00:00.000Z"}
  },
  {
    "phone": "13800138002",
    "idCard": "110101199001011234",
    "level": "intermediate",
    "createTime": {"$date": "2024-01-01T00:00:00.000Z"}
  },
  {
    "phone": "13800138003",
    "idCard": "110101199001015678",
    "level": "senior",
    "createTime": {"$date": "2024-01-01T00:00:00.000Z"}
  }
]
```

### 5.3 商品分类 (categories)

```json
[
  {
    "name": "实物奖品",
    "icon": "🎁",
    "sort": 1,
    "createTime": {"$date": "2024-01-01T00:00:00.000Z"}
  },
  {
    "name": "虚拟商品",
    "icon": "💳",
    "sort": 2,
    "createTime": {"$date": "2024-01-01T00:00:00.000Z"}
  },
  {
    "name": "优惠券",
    "icon": "🎫",
    "sort": 3,
    "createTime": {"$date": "2024-01-01T00:00:00.000Z"}
  }
]
```

### 5.4 示例商品 (goods)

```json
[
  {
    "name": "定制笔记本",
    "description": "科讯嘉联定制精美笔记本，采用优质纸张，书写流畅。",
    "images": [],
    "points": 500,
    "originalPoints": 800,
    "stock": 100,
    "sold": 25,
    "category": "实物奖品",
    "status": "on",
    "sort": 1,
    "createTime": {"$date": "2024-01-01T00:00:00.000Z"},
    "updateTime": {"$date": "2024-01-01T00:00:00.000Z"}
  },
  {
    "name": "精美水杯",
    "description": "304不锈钢保温杯，保温保冷两用。",
    "images": [],
    "points": 1000,
    "originalPoints": 1500,
    "stock": 50,
    "sold": 12,
    "category": "实物奖品",
    "status": "on",
    "sort": 2,
    "createTime": {"$date": "2024-01-01T00:00:00.000Z"},
    "updateTime": {"$date": "2024-01-01T00:00:00.000Z"}
  },
  {
    "name": "学习课程券",
    "description": "可兑换一门指定的线上学习课程。",
    "images": [],
    "points": 2000,
    "originalPoints": 0,
    "stock": 200,
    "sold": 45,
    "category": "优惠券",
    "status": "on",
    "sort": 3,
    "createTime": {"$date": "2024-01-01T00:00:00.000Z"},
    "updateTime": {"$date": "2024-01-01T00:00:00.000Z"}
  },
  {
    "name": "定制T恤",
    "description": "纯棉舒适，印有训机师学苑标志。",
    "images": [],
    "points": 3000,
    "originalPoints": 4000,
    "stock": 30,
    "sold": 8,
    "category": "实物奖品",
    "status": "on",
    "sort": 4,
    "createTime": {"$date": "2024-01-01T00:00:00.000Z"},
    "updateTime": {"$date": "2024-01-01T00:00:00.000Z"}
  },
  {
    "name": "蓝牙耳机",
    "description": "高品质无线蓝牙耳机，音质出众。",
    "images": [],
    "points": 5000,
    "originalPoints": 8000,
    "stock": 20,
    "sold": 5,
    "category": "实物奖品",
    "status": "on",
    "sort": 5,
    "createTime": {"$date": "2024-01-01T00:00:00.000Z"},
    "updateTime": {"$date": "2024-01-01T00:00:00.000Z"}
  }
]
```

### 5.5 公告 (notices)

```json
[
  {
    "title": "欢迎来到训机师学苑积分商城",
    "content": "欢迎使用积分商城，您可以通过完成任务获取积分，兑换精美礼品！",
    "type": "system",
    "status": "on",
    "sort": 1,
    "createTime": {"$date": "2024-01-01T00:00:00.000Z"}
  },
  {
    "title": "积分获取攻略",
    "content": "完成培训课程、参与活动、推荐学员均可获得积分奖励。",
    "type": "info",
    "status": "on",
    "sort": 2,
    "createTime": {"$date": "2024-01-01T00:00:00.000Z"}
  }
]
```

### 5.6 添加管理员

将你的 openid 添加到 `admins` 集合中：

```json
{
  "openid": "你的openid",
  "name": "管理员",
  "phone": "",
  "role": "super",
  "permissions": ["all"],
  "createTime": {"$date": "2024-01-01T00:00:00.000Z"}
}
```

## 6. 等级匹配说明

重要更新：等级不再与积分数量捆绑，而是通过手机号或身份证号码从系统数据库匹配。

### 等级匹配逻辑

1. 用户首次登录时，可以提供手机号或身份证号
2. 系统在 `level_mappings` 集合中查找匹配的记录
3. 根据匹配结果设置用户等级
4. 积分仅用于商品兑换，不影响等级

### 学员表 (users) 结构

```json
{
  "_openid": "用户的openid",
  "name": "学员姓名",
  "avatar": "头像URL",
  "phone": "手机号",
  "idCard": "身份证号",
  "level": "junior", // 等级：junior/intermediate/senior
  "points": 0, // 积分数量，与等级独立
  "totalPoints": 0,
  "createTime": "创建时间",
  "updateTime": "更新时间"
}
```

## 7. 部署云函数

1. 在微信开发者工具中，右键点击 `cloudfunctions` 目录下的每个云函数文件夹
2. 选择「上传并部署：云端安装依赖」
3. 等待云函数部署完成

需要部署的云函数：
- login
- getPoints
- exchange
- adminGrantPoints
- verifyOrder

## 8. 数据库索引（可选但推荐）

为提升查询性能，建议创建以下索引：

- `users`: `_openid` (唯一), `phone`, `idCard`
- `level_mappings`: `phone`, `idCard`
- `points_logs`: `userId`, `createTime`
- `orders`: `userId`, `createTime`, `exchangeCode`
- `goods`: `status`, `sort`, `category`
- `addresses`: `userId`, `isDefault`

## 9. 测试

1. 使用微信扫码登录小程序
2. 验证首页是否正常显示
3. 在云开发控制台手动给用户增加一些积分
4. 测试商品兑换流程
5. 用管理员账号测试发放积分和核销功能
6. 在 `level_mappings` 集合中添加测试数据，验证等级匹配功能

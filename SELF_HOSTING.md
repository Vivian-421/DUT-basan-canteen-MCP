# 独立运行与自托管

普通使用者直接按README连接公开服务即可。本文件面向想在自己电脑或VPS运行源码的人；独立部署不会读取公开服务上已有的个人档案。

## 安装与构建

需要Node.js 22.20或更新版本。HTTP模式还需要可连接的MongoDB（例如MongoDB 8）；stdio模式不需要数据库或邮箱。

```sh
npm ci
npm run typecheck
npm test
npm run build
```

安装后不要把node_modules、dist、.env或data提交到仓库。数据分别由MongoDB和本地反馈文件保存，升级源码前保留这两部分数据即可。

## HTTP与注册网页

将`.env.example`复制为`.env`，设置MongoDB连接和自己的发信邮箱，然后运行：

```sh
npm start
```

默认打开`http://localhost:3301/canteen`。公开连接地址是`http://localhost:3301/mcp/canteen-public`；网页会根据`CANTEEN_MCP_PUBLIC_URL`生成地址。QQ邮箱需开启SMTP并使用邮箱提供的SMTP授权码，不能填写QQ密码。邮箱未配置时页面会明确显示未就绪。

| 配置 | 含义 |
| --- | --- |
| HOST／PORT | 默认仅监听本机127.0.0.1:3301；容器内部可设HOST=0.0.0.0 |
| CANTEEN_MCP_PUBLIC_URL | 使用者实际访问的源站地址；公网设自己的HTTPS域名，不带/canteen路径 |
| MONGO_URI | 独立Mongo数据库连接 |
| CANTEEN_SMTP_USER／CANTEEN_SMTP_PASSWORD | 发信邮箱与SMTP授权码 |
| CANTEEN_SMTP_HOST／PORT／SECURE | 默认QQ邮箱smtp.qq.com:465，TLS开启；其他邮箱按服务商说明设置 |
| CANTEEN_PREFERENCES_FILE | stdio反馈文件；HTTP个人反馈保存在它同目录的public/下 |
| CANTEEN_MENU_FILE | 可选的外置菜单JSON；留空使用内置快照 |

在VPS上让反向代理把自己的HTTPS域名转发到127.0.0.1:3301，并设置对应的CANTEEN_MCP_PUBLIC_URL。应用按这个URL决定是否使用Secure Cookie；本地HTTP开发与公网HTTPS分别使用自己的配置。

注册网页沿用公开服务功能：邮箱验证码、生成DSH配置、复制配置、查看已有连接、撤销全部客户端连接和退出。每个邮箱对应一个独立档案，不需要聊天平台账号。MongoDB保存档案、验证码哈希和凭据哈希；HTTP偏好及备注保存在data/canteen/public/，首次为空。备份MongoDB与data目录才能完整恢复档案。

公开HTTP接口：`/api/canteen-public/status`、`code`、`verify`、`profile`、`connections`、`logout`；MCP入口只接受携带个人Bearer凭据的POST。`/health`用于启动检查。不提供聊天平台作者专用的OAuth入口。

## 本地stdio

构建后，在支持stdio的客户端中配置Node运行绝对路径：

```json
{
  "mcpServers": {
    "basan": {
      "command": "node",
      "args": ["/绝对路径/DUT-basan-canteen-MCP/dist/server/stdio.js"],
      "env": {
        "CANTEEN_PREFERENCES_FILE": "/绝对路径/自己的八三评价.json"
      }
    }
  }
}
```

Windows将路径换成自己的`D:/...`路径。stdio直接使用指定的个人反馈文件；不会弹出邮箱注册网页，也不会与公开服务上的邮箱档案自动同步。需要多客户端共用记录时使用HTTP邮箱档案模式。

## 验证与开发

- `npm test`：菜单查询、预算筛选、偏好／备注持久化、邮箱档案及网页操作回归；测试使用临时MongoDB，不发送真实邮件。
- `npm run test:smoke`：构建后实际启动stdio与HTTP入口，检查工具调用和网页资源。
- `npm run test:dsh`：使用真实DSH MCP客户端。先在单独目录安装`@deepseek-ai/dsh-mcp-client`，通过环境变量DSH_RUNTIME_DIR指向该目录，再运行此命令；不调用模型或发送QQ消息。

源码对应关系和参考项目见[来源说明](docs/source-map.md)。README为作者本人修改的使用说明，独立源码发布时保留原文。

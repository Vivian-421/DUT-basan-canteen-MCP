# 源码来源与结构

本仓库从个人自托管VivianChat中的八三模块提取，来源提交`e2603c4ae0207738311775dee28ba3862f27f6b2`。保留MIT许可证，原始版权声明见根目录LICENSE。

| 本仓库 | 原实现 | 用途 |
| --- | --- | --- |
| src/canteenMenu.ts、canteenPreferences.ts、canteenMenu.snapshot.json | LibreChat-vivian/packages/api/src/mcp/servers/同名文件 | 四个MCP工具、菜单快照、文件偏好与备注 |
| src/canteenPublic.ts | 同目录canteenPublic.ts | 邮箱验证码、浏览器会话、客户端凭据、独立档案HTTP MCP |
| src/models.ts | packages/data-schemas/src/models/canteen.ts | 独立食堂档案的Mongo模型 |
| web/Public.tsx、queries.ts、api.ts | client/src/components/CanteenMenu/Public.tsx及公开数据接口 | 注册、生成配置、复制、撤销与退出 |
| web/Input.tsx、Button.tsx | packages/client/src/components/同名文件 | 已使用的基础控件 |

提取时只调整模块导入和独立入口；工具参数与档案机制沿用原实现。网页将共享主题变量和文案收拢到本仓库，不依赖聊天账号或聊天平台包。只包含版本化菜单快照，不包含项目作者的个人反馈或服务器配置。

菜单与反馈、HTTP档案及网页回归测试来自原模块；只移除了依赖LibreChat agent运行器的专有上下文测试，保留MCP初始化说明验证。DSH验证使用实际发布的客户端，不调用模型、不发送QQ消息。

参考官方TypeScript SDK的[v1无状态Streamable HTTP示例](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/simpleStatelessStreamableHttp.ts)，沿用无状态JSON响应；没有引入额外会话服务。原网页布局参考[shadcn/ui login-01](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/blocks/login-01/components/login-form.tsx)，使用现有控件自行组织布局。

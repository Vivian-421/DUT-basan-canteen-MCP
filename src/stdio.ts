import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createCanteenMenuServer } from './canteenMenu';

void createCanteenMenuServer()
  .connect(new StdioServerTransport())
  .catch((error: unknown) => {
    console.error(
      '[canteen-menu-mcp] 启动失败',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });

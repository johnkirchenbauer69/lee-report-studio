import { createMockNarrativeMcp } from "./mockNarrativeMcpServer.ts";

/**
 * Standalone entry point for the mock LEE Intelligence MCP, started by
 * playwright.config.ts as a webServer. Kept separate from the module so the
 * module never has to guess whether it was run directly.
 */
const port = Number(process.env.MOCK_NARRATIVE_MCP_PORT ?? 8790);
const mock = createMockNarrativeMcp();
await mock.listen(port);
console.log(`Mock LEE Intelligence MCP listening on http://127.0.0.1:${port}/mcp`);

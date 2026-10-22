import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

if (process.argv.includes('--server')) {
  serveStdio(() => {
    const server = new McpServer({ name: 'forgecut-integration-check', version: '0.0.0' });
    server.registerTool('read_sample', { description: 'Read the integration fixture', annotations: { readOnlyHint: true } }, () => ({ content: [{ type: 'text', text: 'ForgeCut integration fixture' }] }));
    return server;
  });
} else {
  const client = new Client({ name: 'forgecut-integration-check-client', version: '0.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(import.meta.url), '--server'] }));
    assert((await client.listTools()).tools.some((tool) => tool.name === 'read_sample'));
    const result = await client.callTool({ name: 'read_sample', arguments: {} });
    assert.equal(result.content[0].text, 'ForgeCut integration fixture');
    console.log(JSON.stringify({ sdk: '2.3.1', stdioDiscovery: true, toolCall: true }));
  } finally {
    await client.close();
  }
}

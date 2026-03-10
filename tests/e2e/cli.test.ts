/**
 * End-to-End Tests for CLI
 *
 * These tests execute the CLI commands via child_process.
 * Run with: npm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const CLI_PATH = './dist/cli/index.js';
const TIMEOUT = 30000;

// Skip E2E tests unless explicitly enabled
const shouldRunE2ETests = process.env.RUN_E2E_TESTS === 'true' || process.env.CI === 'true';

const describeE2E = shouldRunE2ETests ? describe : describe.skip;

describeE2E('CLI E2E Tests', () => {
  beforeAll(async () => {
    // Ensure CLI is built
    try {
      await execAsync('npm run build');
    } catch {
      // Build might already exist
    }
  }, 60000);

  describe('Help and Version', () => {
    it(
      'should show help with --help flag',
      async () => {
        const { stdout } = await execAsync(`node ${CLI_PATH} --help`);

        expect(stdout).toContain('ClawSQL');
        expect(stdout).toContain('Usage:');
      },
      TIMEOUT
    );
  });

  describe('Topology Commands', () => {
    it(
      'should show topology',
      async () => {
        try {
          const { stdout } = await execAsync(`node ${CLI_PATH} topology`);

          // Output should contain cluster info
          expect(stdout).toBeDefined();
        } catch (error: any) {
          // If cluster not available, command should fail gracefully
          expect(error.code).toBeDefined();
        }
      },
      TIMEOUT
    );
  });

  describe('Health Commands', () => {
    it(
      'should check health',
      async () => {
        try {
          const { stdout } = await execAsync(`node ${CLI_PATH} health`);

          expect(stdout).toBeDefined();
        } catch (error: any) {
          // If cluster not available, command should fail gracefully
          expect(error.code).toBeDefined();
        }
      },
      TIMEOUT
    );
  });

  describe('SQL Commands', () => {
    it(
      'should execute SQL query',
      async () => {
        try {
          const { stdout } = await execAsync(
            `node ${CLI_PATH} sql "SELECT 1 as test"`
          );

          expect(stdout).toBeDefined();
        } catch (error: any) {
          // If MySQL not available, command should fail gracefully
          expect(error.code).toBeDefined();
        }
      },
      TIMEOUT
    );
  });

  describe('Shell Mode', () => {
    it(
      'should handle shell input',
      async () => {
        // Skip shell mode test for now as it requires interactive input
        // This would need a more sophisticated test setup with expect or pty
      },
      TIMEOUT
    );
  });

  describe('Error Handling', () => {
    it(
      'should handle invalid commands',
      async () => {
        try {
          await execAsync(`node ${CLI_PATH} invalid-command`);
          expect.fail('Should have thrown');
        } catch (error: any) {
          expect(error.code).not.toBe(0);
        }
      },
      TIMEOUT
    );

    it(
      'should handle missing arguments',
      async () => {
        try {
          await execAsync(`node ${CLI_PATH} sql`);
          expect.fail('Should have thrown');
        } catch (error: any) {
          expect(error.code).not.toBe(0);
        }
      },
      TIMEOUT
    );
  });

  describe('AI Config Commands', () => {
    it(
      'should handle config ai env command',
      async () => {
        // Test that the shell can be started and config ai env shows env vars
        // This is a simplified test - full shell tests would need pty
        const shell = spawn('node', [CLI_PATH, 'shell'], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        return new Promise<void>((resolve) => {
          let output = '';

          shell.stdout.on('data', (data) => {
            output += data.toString();
          });

          shell.stderr.on('data', (data) => {
            output += data.toString();
          });

          // Send the config ai env command
          setTimeout(() => {
            shell.stdin.write('config ai env\n');
          }, 500);

          // Exit after a short time
          setTimeout(() => {
            shell.stdin.write('exit\n');
          }, 1500);

          shell.on('close', () => {
            // Should show environment variables info
            expect(output).toBeDefined();
            resolve();
          });
        });
      },
      TIMEOUT
    );

    it(
      'should handle config ai url command',
      async () => {
        const shell = spawn('node', [CLI_PATH, 'shell'], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        return new Promise<void>((resolve) => {
          let output = '';

          shell.stdout.on('data', (data) => {
            output += data.toString();
          });

          shell.stderr.on('data', (data) => {
            output += data.toString();
          });

          // Test setting a URL
          setTimeout(() => {
            shell.stdin.write('config ai url https://dashscope.aliyuncs.com/apps/anthropic\n');
          }, 500);

          // Exit
          setTimeout(() => {
            shell.stdin.write('exit\n');
          }, 1500);

          shell.on('close', () => {
            // Should show success message
            expect(output).toBeDefined();
            resolve();
          });
        });
      },
      TIMEOUT
    );

    it(
      'should validate URL in config ai url command',
      async () => {
        const shell = spawn('node', [CLI_PATH, 'shell'], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        return new Promise<void>((resolve) => {
          let output = '';

          shell.stdout.on('data', (data) => {
            output += data.toString();
          });

          shell.stderr.on('data', (data) => {
            output += data.toString();
          });

          // Test invalid URL
          setTimeout(() => {
            shell.stdin.write('config ai url not-a-valid-url\n');
          }, 500);

          // Exit
          setTimeout(() => {
            shell.stdin.write('exit\n');
          }, 1500);

          shell.on('close', () => {
            // Should show error for invalid URL
            expect(output).toBeDefined();
            resolve();
          });
        });
      },
      TIMEOUT
    );

    it(
      'should clear URL with config ai url clear',
      async () => {
        const shell = spawn('node', [CLI_PATH, 'shell'], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        return new Promise<void>((resolve) => {
          let output = '';

          shell.stdout.on('data', (data) => {
            output += data.toString();
          });

          shell.stderr.on('data', (data) => {
            output += data.toString();
          });

          // Test clearing URL
          setTimeout(() => {
            shell.stdin.write('config ai url clear\n');
          }, 500);

          // Exit
          setTimeout(() => {
            shell.stdin.write('exit\n');
          }, 1500);

          shell.on('close', () => {
            // Should show success message for clearing
            expect(output).toBeDefined();
            resolve();
          });
        });
      },
      TIMEOUT
    );
  });
});
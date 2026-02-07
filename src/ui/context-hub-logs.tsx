#!/usr/bin/env node
/**
 * Context Hub Logs TUI
 *
 * Real-time log viewer with syntax highlighting
 *
 * @purpose TUI for streaming context-hub logs with @ tag highlighting
 */

import React, { useState, useEffect } from 'react';
import { render, Box, Text } from 'ink';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'warn' | 'success';
}

interface CLITool {
  name: string;
  command: string;
  available: boolean;
  version?: string;
}

const ContextHubLogs = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<'running' | 'stopped' | 'unknown'>('unknown');
  const [pid, setPid] = useState<number | null>(null);
  const [tools, setTools] = useState<CLITool[]>([]);

  // Get project root
  const projectRoot = process.cwd();
  const logFile = path.join(projectRoot, '.jfl/logs/context-hub.log');

  useEffect(() => {
    // Check status
    exec('jfl context-hub status', (error, stdout) => {
      if (stdout.includes('running')) {
        setStatus('running');
        const pidMatch = stdout.match(/PID: (\d+)/);
        if (pidMatch) setPid(parseInt(pidMatch[1], 10));
      } else {
        setStatus('stopped');
      }
    });

    // Check available CLI tools
    const cliTools = [
      { name: 'gh', command: 'gh --version' },
      { name: 'fly', command: 'fly version' },
      { name: 'vercel', command: 'vercel --version' },
      { name: 'supabase', command: 'supabase --version' },
      { name: 'docker', command: 'docker --version' },
      { name: 'jfl', command: 'jfl --version' },
      { name: 'git', command: 'git --version' },
      { name: 'node', command: 'node --version' },
    ];

    const checkTools = async () => {
      const results: CLITool[] = [];

      for (const tool of cliTools) {
        exec(`which ${tool.name}`, (error, stdout) => {
          const available = !error && stdout.trim().length > 0;

          if (available) {
            // Get version
            exec(tool.command, (vErr, vOut) => {
              const version = vErr ? undefined : vOut.trim().split('\n')[0];
              results.push({
                name: tool.name,
                command: tool.command,
                available: true,
                version
              });
              if (results.length === cliTools.length) {
                setTools(results.sort((a, b) => a.name.localeCompare(b.name)));
              }
            });
          } else {
            results.push({
              name: tool.name,
              command: tool.command,
              available: false
            });
            if (results.length === cliTools.length) {
              setTools(results.sort((a, b) => a.name.localeCompare(b.name)));
            }
          }
        });
      }
    };

    checkTools();

    // Watch log file
    if (!fs.existsSync(logFile)) {
      setLogs([{ timestamp: new Date().toISOString(), message: 'No log file yet', type: 'warn' }]);
      return;
    }

    // Read existing logs
    const content = fs.readFileSync(logFile, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const entries = lines.slice(-50).map(line => parseLogLine(line)); // Last 50 lines
    setLogs(entries);

    // Watch for new lines
    const watcher = fs.watch(logFile, (event) => {
      if (event === 'change') {
        const newContent = fs.readFileSync(logFile, 'utf-8');
        const newLines = newContent.split('\n').filter(l => l.trim());
        const newEntries = newLines.slice(-50).map(line => parseLogLine(line));
        setLogs(newEntries);
      }
    });

    return () => watcher.close();
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">
          Context Hub Logs
        </Text>
        <Text dimColor> | </Text>
        <Text color={status === 'running' ? 'green' : 'red'}>
          {status === 'running' ? '🟢 Running' : '🔴 Stopped'}
        </Text>
        {pid && (
          <>
            <Text dimColor> | PID: </Text>
            <Text>{pid}</Text>
          </>
        )}
      </Box>

      <Box flexDirection="row" marginTop={1}>
        {/* Logs section */}
        <Box flexDirection="column" flexGrow={1} marginRight={1}>
          {logs.map((log, i) => (
            <LogLine key={i} entry={log} />
          ))}
        </Box>

        {/* CLI Tools sidebar */}
        <Box flexDirection="column" width={25} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text bold dimColor>Available CLIs</Text>
          <Text dimColor>───────────────────</Text>
          {tools.length === 0 ? (
            <Text dimColor>Checking...</Text>
          ) : (
            tools.map((tool, i) => (
              <Box key={i} marginTop={i > 0 ? 0 : 0}>
                <Text color={tool.available ? 'green' : 'red'}>
                  {tool.available ? '✓' : '✗'}
                </Text>
                <Text dimColor> </Text>
                <Text color={tool.available ? undefined : 'dim'}>
                  {tool.name}
                </Text>
              </Box>
            ))
          )}
        </Box>
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          Press Ctrl+C to exit | Showing last 50 lines
        </Text>
      </Box>
    </Box>
  );
};

const LogLine: React.FC<{ entry: LogEntry }> = ({ entry }) => {
  const { message, type } = entry;

  // Highlight @ tags
  const highlightMessage = (msg: string) => {
    const parts: React.ReactNode[] = [];
    const regex = /@(\w+)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(msg)) !== null) {
      // Text before @tag
      if (match.index > lastIndex) {
        parts.push(
          <Text key={`text-${lastIndex}`}>
            {msg.slice(lastIndex, match.index)}
          </Text>
        );
      }

      // @tag itself
      parts.push(
        <Text key={`tag-${match.index}`} color="magenta" bold>
          {match[0]}
        </Text>
      );

      lastIndex = match.index + match[0].length;
    }

    // Remaining text
    if (lastIndex < msg.length) {
      parts.push(
        <Text key={`text-${lastIndex}`}>
          {msg.slice(lastIndex)}
        </Text>
      );
    }

    return parts.length > 0 ? parts : <Text>{msg}</Text>;
  };

  const getColor = () => {
    if (message.includes('error') || message.includes('Error')) return 'red';
    if (message.includes('warn')) return 'yellow';
    if (message.includes('✓') || message.includes('Started') || message.includes('listening')) return 'green';
    if (message.includes('Shutting down')) return 'red';
    return undefined;
  };

  return (
    <Box>
      <Text color={getColor()}>
        {highlightMessage(message)}
      </Text>
    </Box>
  );
};

function parseLogLine(line: string): LogEntry {
  // Determine type based on content
  let type: LogEntry['type'] = 'info';
  if (line.includes('error') || line.includes('Error')) type = 'error';
  else if (line.includes('warn')) type = 'warn';
  else if (line.includes('✓') || line.includes('Started')) type = 'success';

  return {
    timestamp: new Date().toISOString(),
    message: line,
    type
  };
}

// Render the component
render(<ContextHubLogs />);

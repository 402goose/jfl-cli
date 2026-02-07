#!/usr/bin/env node
/**
 * JFL Services Manager TUI
 *
 * Interactive service management dashboard with live updates,
 * logs, chat, and service controls
 *
 * @purpose Full-featured TUI for managing JFL services with real-time updates
 */

import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Types
interface Service {
  name: string;
  status: 'running' | 'stopped' | 'error';
  pid?: number;
  port?: number;
  uptime?: string;
  memory?: string;
  cpu?: string;
  description?: string;
}

type View = 'dashboard' | 'logs' | 'chat' | 'add';

const ServicesManager = () => {
  const [services, setServices] = useState<Service[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [view, setView] = useState<View>('dashboard');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [chatMessages, setChatMessages] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const { exit } = useApp();

  // Load services
  useEffect(() => {
    const loadServices = () => {
      exec('jfl services list', (error, stdout) => {
        if (error) {
          setServices([]);
          return;
        }

        // Parse service list
        const lines = stdout.split('\n').filter(l => l.trim());
        const parsed: Service[] = [];

        for (const line of lines) {
          // Example format: "service-name  ● running  1234  8080  2h30m  128MB  1.2%  Description"
          const parts = line.trim().split(/\s{2,}/);
          if (parts.length >= 2) {
            const status = parts[1]?.includes('running') ? 'running' :
                          parts[1]?.includes('stopped') ? 'stopped' : 'error';

            parsed.push({
              name: parts[0],
              status,
              pid: parts[2] ? parseInt(parts[2]) : undefined,
              port: parts[3] ? parseInt(parts[3]) : undefined,
              uptime: parts[4],
              memory: parts[5],
              cpu: parts[6],
              description: parts[7]
            });
          }
        }

        setServices(parsed);
      });
    };

    loadServices();
    const interval = setInterval(loadServices, 2000); // Refresh every 2s

    return () => clearInterval(interval);
  }, []);

  // Keyboard controls
  useInput((input, key) => {
    if (key.escape || (input === 'q' && view === 'dashboard')) {
      exit();
      return;
    }

    if (view === 'dashboard') {
      if (key.upArrow) {
        setSelectedIndex(Math.max(0, selectedIndex - 1));
      } else if (key.downArrow) {
        setSelectedIndex(Math.min(services.length - 1, selectedIndex + 1));
      } else if (input === 'l') {
        setView('logs');
        loadLogs();
      } else if (input === 'c') {
        setView('chat');
      } else if (input === 'a') {
        setView('add');
      } else if (input === 's') {
        startService();
      } else if (input === 'x') {
        stopService();
      } else if (input === 'r') {
        restartService();
      } else if (input === 'd') {
        removeService();
      }
    } else if (key.escape) {
      setView('dashboard');
      setLogLines([]);
      setChatMessages([]);
    }
  });

  const loadLogs = () => {
    const service = services[selectedIndex];
    if (!service) return;

    const logFile = `.jfl/logs/${service.name}.log`;
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf-8');
      const lines = content.split('\n').slice(-50);
      setLogLines(lines);

      // Watch for updates
      const watcher = fs.watch(logFile, () => {
        const newContent = fs.readFileSync(logFile, 'utf-8');
        setLogLines(newContent.split('\n').slice(-50));
      });

      setTimeout(() => watcher.close(), 30000); // Auto-close after 30s
    }
  };

  const startService = () => {
    const service = services[selectedIndex];
    if (service) {
      exec(`jfl services start ${service.name}`, () => {});
    }
  };

  const stopService = () => {
    const service = services[selectedIndex];
    if (service) {
      exec(`jfl services stop ${service.name}`, () => {});
    }
  };

  const restartService = () => {
    const service = services[selectedIndex];
    if (service) {
      exec(`jfl services restart ${service.name}`, () => {});
    }
  };

  const removeService = () => {
    const service = services[selectedIndex];
    if (service) {
      exec(`jfl services remove ${service.name}`, () => {});
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box borderStyle="double" borderColor="cyan" paddingX={2}>
        <Text bold color="cyan">⚡ JFL Services Manager</Text>
        <Text dimColor> | </Text>
        <Text color="magenta">{services.length} services</Text>
        <Text dimColor> | </Text>
        <Text dimColor>{view.toUpperCase()}</Text>
      </Box>

      {/* Main Content */}
      <Box flexDirection="column" marginTop={1}>
        {view === 'dashboard' && <DashboardView services={services} selectedIndex={selectedIndex} />}
        {view === 'logs' && <LogsView service={services[selectedIndex]} lines={logLines} />}
        {view === 'chat' && <ChatView service={services[selectedIndex]} messages={chatMessages} />}
        {view === 'add' && <AddServiceView />}
      </Box>

      {/* Footer / Controls */}
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        {view === 'dashboard' && (
          <Text dimColor>
            ↑↓: Select | <Text color="green">s</Text>: Start | <Text color="red">x</Text>: Stop |
            <Text color="yellow">r</Text>: Restart | <Text color="blue">l</Text>: Logs |
            <Text color="magenta">c</Text>: Chat | <Text color="cyan">a</Text>: Add |
            <Text color="red">d</Text>: Remove | <Text bold>q</Text>: Quit
          </Text>
        )}
        {view !== 'dashboard' && (
          <Text dimColor>
            <Text bold>ESC</Text>: Back to dashboard
          </Text>
        )}
      </Box>
    </Box>
  );
};

// Dashboard View
const DashboardView: React.FC<{ services: Service[]; selectedIndex: number }> = ({ services, selectedIndex }) => {
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
        <Text bold dimColor>NAME</Text>
        <Text dimColor>          </Text>
        <Text bold dimColor>STATUS</Text>
        <Text dimColor>     </Text>
        <Text bold dimColor>PID</Text>
        <Text dimColor>      </Text>
        <Text bold dimColor>PORT</Text>
        <Text dimColor>    </Text>
        <Text bold dimColor>UPTIME</Text>
        <Text dimColor>    </Text>
        <Text bold dimColor>MEM</Text>
        <Text dimColor>     </Text>
        <Text bold dimColor>CPU</Text>
      </Box>

      {services.length === 0 ? (
        <Box paddingX={2}>
          <Text dimColor>No services found. Press </Text>
          <Text color="cyan" bold>a</Text>
          <Text dimColor> to add one.</Text>
        </Box>
      ) : (
        services.map((service, i) => (
          <ServiceRow
            key={service.name}
            service={service}
            selected={i === selectedIndex}
          />
        ))
      )}
    </Box>
  );
};

// Service Row
const ServiceRow: React.FC<{ service: Service; selected: boolean }> = ({ service, selected }) => {
  const statusColor = service.status === 'running' ? 'green' :
                     service.status === 'stopped' ? 'yellow' : 'red';
  const statusIcon = service.status === 'running' ? '●' :
                    service.status === 'stopped' ? '○' : '✗';

  return (
    <Box>
      <Text color={selected ? 'cyan' : undefined} bold={selected}>
        {selected ? '▶ ' : '  '}
        {service.name.padEnd(15)}
      </Text>
      <Text color={statusColor}>
        {statusIcon} {service.status.padEnd(10)}
      </Text>
      <Text dimColor>
        {(service.pid?.toString() || 'N/A').padEnd(8)}
        {(service.port?.toString() || 'N/A').padEnd(8)}
        {(service.uptime || 'N/A').padEnd(10)}
        {(service.memory || 'N/A').padEnd(8)}
        {(service.cpu || 'N/A').padEnd(6)}
      </Text>
    </Box>
  );
};

// Logs View
const LogsView: React.FC<{ service?: Service; lines: string[] }> = ({ service, lines }) => {
  if (!service) {
    return <Text dimColor>No service selected</Text>;
  }

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="yellow" paddingX={1} marginBottom={1}>
        <Text bold color="yellow">📋 Logs: {service.name}</Text>
      </Box>

      <Box flexDirection="column" height={30}>
        {lines.length === 0 ? (
          <Text dimColor>No logs available</Text>
        ) : (
          lines.map((line, i) => (
            <Text key={i}>{line}</Text>
          ))
        )}
      </Box>
    </Box>
  );
};

// Chat View
const ChatView: React.FC<{ service?: Service; messages: string[] }> = ({ service, messages }) => {
  if (!service) {
    return <Text dimColor>No service selected</Text>;
  }

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="magenta" paddingX={1} marginBottom={1}>
        <Text bold color="magenta">💬 Chat with {service.name} agent</Text>
      </Box>

      <Box flexDirection="column" height={25}>
        {messages.length === 0 ? (
          <Box flexDirection="column">
            <Text dimColor>Start a conversation with the {service.name} agent.</Text>
            <Box><Text dimColor>Type your message and press Enter.</Text></Box>
            <Box><Text dimColor>The agent can help with:</Text></Box>
            <Text color="cyan">  • Service status and health</Text>
            <Text color="cyan">  • Configuration changes</Text>
            <Text color="cyan">  • Debugging issues</Text>
            <Text color="cyan">  • Performance optimization</Text>
          </Box>
        ) : (
          messages.map((msg, i) => (
            <Text key={i}>{msg}</Text>
          ))
        )}
      </Box>

      <Box>
        <Text dimColor>Coming soon: Agent chat integration via MCP</Text>
      </Box>
    </Box>
  );
};

// Add Service View
const AddServiceView: React.FC = () => {
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Text bold color="cyan">➕ Add New Service</Text>
      </Box>

      <Box flexDirection="column" paddingX={2}>
        <Text color="yellow" bold>Coming soon!</Text>
        <Box><Text dimColor>You'll be able to add services by:</Text></Box>
        <Box><Text color="cyan">  • Entering a git URL</Text></Box>
        <Text color="cyan">  • Selecting from templates</Text>
        <Text color="cyan">  • Importing from a local path</Text>
        <Box><Text dimColor>For now, use: <Text color="green">jfl service add &lt;name&gt; &lt;url&gt;</Text></Text></Box>
      </Box>
    </Box>
  );
};

// Render the component
render(<ServicesManager />);

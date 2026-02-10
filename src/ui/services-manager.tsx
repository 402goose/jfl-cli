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
import { render, Box, Text, useInput, useApp, useStdout } from 'ink';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { JFL_PATHS } from '../utils/jfl-paths.js';

// Types
interface Service {
  name: string;
  status: 'running' | 'stopped' | 'error';
  health?: 'healthy' | 'unhealthy' | 'unknown';
  pid?: number;
  port?: number;
  uptime?: string;
  memory?: string;
  cpu?: string;
  description?: string;
  log_path?: string;
  health_url?: string;
}

type View = 'dashboard' | 'logs' | 'chat' | 'add';

interface ServiceManagerConfig {
  port: number;
}

const DEFAULT_PORT = 3402;
const CONFIG_FILE = path.join(JFL_PATHS.config, 'service-manager.json');

function getServiceManagerPort(): number {
  if (process.env.JFL_SERVICE_MANAGER_PORT) {
    return parseInt(process.env.JFL_SERVICE_MANAGER_PORT, 10);
  }

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const config: ServiceManagerConfig = JSON.parse(content);
      return config.port;
    }
  } catch {
    // Fallback to default
  }

  return DEFAULT_PORT;
}

const ServicesManager = () => {
  const [services, setServices] = useState<Service[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [view, setView] = useState<View>('dashboard');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logScrollOffset, setLogScrollOffset] = useState(0);
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);
  const [chatMessages, setChatMessages] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalHeight = (stdout?.rows || 24) - 2; // Leave 2 lines of breathing room

  // Load services from Service Manager API
  useEffect(() => {
    const loadServices = async () => {
      try {
        const SERVICE_MANAGER_PORT = getServiceManagerPort();

        // Check if Service Manager is running
        const healthResponse = await fetch(`http://localhost:${SERVICE_MANAGER_PORT}/health`);
        if (!healthResponse.ok) {
          console.error('Service Manager not responding. Start it with:');
          console.error(`  jfl service-manager start --port ${SERVICE_MANAGER_PORT}`);
          setServices([]);
          return;
        }

        // Fetch services from API
        const response = await fetch(`http://localhost:${SERVICE_MANAGER_PORT}/services`);
        const data = await response.json();

        // Map API response to TUI format
        const mapped: Service[] = data.services.map((svc: any) => {
          // Calculate uptime if service is running
          let uptime: string | undefined;
          if (svc.started_at && svc.status === 'running') {
            const startTime = new Date(svc.started_at);
            const now = new Date();
            const diffMs = now.getTime() - startTime.getTime();
            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            uptime = hours > 0 ? `${hours}h${minutes}m` : `${minutes}m`;
          }

          return {
            name: svc.name,
            status: svc.status === 'running' ? 'running' :
                   svc.status === 'stopped' ? 'stopped' : 'error',
            health: 'unknown', // Will be updated by health check
            pid: svc.pid,
            port: svc.port,
            uptime,
            // Memory and CPU stats not available yet from Service Manager
            // Could be added later via process stats
            memory: undefined,
            cpu: undefined,
            description: svc.description,
            log_path: svc.log_path,
            health_url: svc.health_url
          };
        });

        setServices(mapped);
      } catch (error) {
        console.error('Failed to fetch services:', error);
        console.error('Make sure Service Manager is running:');
        console.error('  jfl service-manager start');
        setServices([]);
      }
    };

    loadServices();
    const interval = setInterval(loadServices, 2000); // Refresh every 2s

    return () => clearInterval(interval);
  }, []);

  // Periodic health checks
  useEffect(() => {
    const runHealthChecks = async () => {
      if (services.length === 0) return;

      const healthPromises = services.map(async (service) => {
        // Only check running services with explicit health_url
        if (service.status !== 'running' || !service.health_url) {
          return { name: service.name, health: 'unknown' as const };
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);

          const response = await fetch(service.health_url, {
            signal: controller.signal
          });

          clearTimeout(timeoutId);
          return {
            name: service.name,
            health: response.ok ? 'healthy' as const : 'unhealthy' as const
          };
        } catch (error) {
          return { name: service.name, health: 'unhealthy' as const };
        }
      });

      const healthResults = await Promise.all(healthPromises);

      // Update services with health status
      setServices(prevServices =>
        prevServices.map(service => {
          const healthResult = healthResults.find(r => r.name === service.name);
          return healthResult ? { ...service, health: healthResult.health } : service;
        })
      );
    };

    // Run initial health check after a short delay
    const initialTimeout = setTimeout(runHealthChecks, 1000);

    // Run health checks every 8 seconds
    const interval = setInterval(runHealthChecks, 8000);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [services.length]);

  // Keyboard controls
  useInput((input, key) => {
    // If not in dashboard, ESC goes back to dashboard
    if (view !== 'dashboard' && key.escape) {
      setView('dashboard');
      setLogLines([]);
      setLogScrollOffset(0);
      setAutoScrollLogs(true);
      setChatMessages([]);
      return;
    }

    // If in dashboard, ESC or q exits the app
    if (view === 'dashboard' && (key.escape || input === 'q')) {
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
        setLogScrollOffset(0);
        setAutoScrollLogs(true);
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
    } else if (view === 'logs') {
      // Scroll controls for logs view
      const visibleHeight = terminalHeight - 6; // Account for header/footer
      const maxScroll = Math.max(0, logLines.length - visibleHeight);

      if (key.upArrow) {
        setLogScrollOffset(Math.max(0, logScrollOffset - 1));
        setAutoScrollLogs(false); // Disable auto-scroll when manually scrolling
      } else if (key.downArrow) {
        const newOffset = Math.min(maxScroll, logScrollOffset + 1);
        setLogScrollOffset(newOffset);
        // Re-enable auto-scroll if we've scrolled to the bottom
        if (newOffset === maxScroll) {
          setAutoScrollLogs(true);
        }
      } else if (key.pageUp) {
        setLogScrollOffset(Math.max(0, logScrollOffset - visibleHeight));
        setAutoScrollLogs(false);
      } else if (key.pageDown) {
        const newOffset = Math.min(maxScroll, logScrollOffset + visibleHeight);
        setLogScrollOffset(newOffset);
        if (newOffset === maxScroll) {
          setAutoScrollLogs(true);
        }
      } else if (input === 'g') {
        // Go to top
        setLogScrollOffset(0);
        setAutoScrollLogs(false);
      } else if (input === 'G') {
        // Go to bottom (and re-enable auto-scroll)
        setLogScrollOffset(maxScroll);
        setAutoScrollLogs(true);
      }
    }
  });

  const loadLogs = () => {
    const service = services[selectedIndex];
    if (!service || !service.log_path) return;

    const logFile = service.log_path;
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim().length > 0);
      setLogLines(lines);

      // Auto-scroll to bottom if enabled
      if (autoScrollLogs) {
        const visibleHeight = terminalHeight - 6;
        setLogScrollOffset(Math.max(0, lines.length - visibleHeight));
      }

      // Watch for updates and tail the log
      const watcher = fs.watch(logFile, () => {
        try {
          const newContent = fs.readFileSync(logFile, 'utf-8');
          const newLines = newContent.split('\n').filter(line => line.trim().length > 0);
          setLogLines(newLines);

          // Auto-scroll to bottom if enabled
          if (autoScrollLogs) {
            const visibleHeight = terminalHeight - 6;
            setLogScrollOffset(Math.max(0, newLines.length - visibleHeight));
          }
        } catch (err) {
          // File might have been rotated or deleted
        }
      });

      // Keep watcher active while in logs view
      return () => watcher.close();
    }
  };

  const startService = async () => {
    const service = services[selectedIndex];
    if (service) {
      try {
        const SERVICE_MANAGER_PORT = getServiceManagerPort();
        await fetch(`http://localhost:${SERVICE_MANAGER_PORT}/services/${service.name}/start`, {
          method: 'POST'
        });
      } catch (error) {
        console.error('Failed to start service:', error);
      }
    }
  };

  const stopService = async () => {
    const service = services[selectedIndex];
    if (service) {
      try {
        const SERVICE_MANAGER_PORT = getServiceManagerPort();
        await fetch(`http://localhost:${SERVICE_MANAGER_PORT}/services/${service.name}/stop`, {
          method: 'POST'
        });
      } catch (error) {
        console.error('Failed to stop service:', error);
      }
    }
  };

  const restartService = async () => {
    const service = services[selectedIndex];
    if (service) {
      try {
        const SERVICE_MANAGER_PORT = getServiceManagerPort();
        await fetch(`http://localhost:${SERVICE_MANAGER_PORT}/services/${service.name}/restart`, {
          method: 'POST'
        });
      } catch (error) {
        console.error('Failed to restart service:', error);
      }
    }
  };

  const removeService = async () => {
    const service = services[selectedIndex];
    if (service) {
      try {
        const SERVICE_MANAGER_PORT = getServiceManagerPort();
        await fetch(`http://localhost:${SERVICE_MANAGER_PORT}/services/${service.name}`, {
          method: 'DELETE'
        });
      } catch (error) {
        console.error('Failed to remove service:', error);
      }
    }
  };

  return (
    <Box flexDirection="column" height={terminalHeight}>
      {/* Header */}
      <Box borderStyle="double" borderColor="cyan" paddingX={2}>
        <Text bold color="cyan">⚡ JFL Services Manager</Text>
        <Text dimColor> | </Text>
        <Text color="magenta">{services.length} services</Text>
        <Text dimColor> | </Text>
        <Text dimColor>{view.toUpperCase()}</Text>
      </Box>

      {/* Main Content */}
      <Box flexDirection="column" flexGrow={1}>
        {view === 'dashboard' && <DashboardView services={services} selectedIndex={selectedIndex} />}
        {view === 'logs' && (
          <LogsView
            service={services[selectedIndex]}
            lines={logLines}
            scrollOffset={logScrollOffset}
            autoScroll={autoScrollLogs}
            visibleHeight={terminalHeight - 6}
          />
        )}
        {view === 'chat' && <ChatView service={services[selectedIndex]} messages={chatMessages} />}
        {view === 'add' && <AddServiceView />}
      </Box>

      {/* Footer / Controls */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        {view === 'dashboard' && (
          <Text dimColor>
            ↑↓: Select | <Text color="green">s</Text>: Start | <Text color="red">x</Text>: Stop |
            <Text color="yellow">r</Text>: Restart | <Text color="blue">l</Text>: Logs |
            <Text color="magenta">c</Text>: Chat | <Text color="cyan">a</Text>: Add |
            <Text color="red">d</Text>: Remove | <Text bold>q</Text>: Quit
          </Text>
        )}
        {view === 'logs' && (
          <Text dimColor>
            ↑↓: Scroll | <Text color="cyan">PgUp/PgDn</Text>: Page |
            <Text color="green">g</Text>: Top | <Text color="green">G</Text>: Bottom (tail) |
            <Text bold>ESC</Text>: Back
          </Text>
        )}
        {view !== 'dashboard' && view !== 'logs' && (
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
        <Text bold dimColor>HEALTH</Text>
        <Text dimColor>    </Text>
        <Text bold dimColor>PID</Text>
        <Text dimColor>      </Text>
        <Text bold dimColor>PORT</Text>
        <Text dimColor>    </Text>
        <Text bold dimColor>UPTIME</Text>
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

  const healthColor = service.health === 'healthy' ? 'green' :
                     service.health === 'unhealthy' ? 'red' : 'gray';
  const healthIcon = service.health === 'healthy' ? '✓' :
                    service.health === 'unhealthy' ? '✗' : '?';

  return (
    <Box>
      <Text color={selected ? 'cyan' : undefined} bold={selected}>
        {selected ? '▶ ' : '  '}
        {service.name.padEnd(15)}
      </Text>
      <Text color={statusColor}>
        {statusIcon} {service.status.padEnd(10)}
      </Text>
      <Text color={healthColor}>
        {healthIcon} {(service.health || 'unknown').padEnd(10)}
      </Text>
      <Text dimColor>
        {(service.pid?.toString() || 'N/A').padEnd(8)}
        {(service.port?.toString() || 'N/A').padEnd(8)}
        {(service.uptime || 'N/A').padEnd(10)}
      </Text>
    </Box>
  );
};

// Logs View
const LogsView: React.FC<{
  service?: Service;
  lines: string[];
  scrollOffset: number;
  autoScroll: boolean;
  visibleHeight: number;
}> = ({ service, lines, scrollOffset, autoScroll, visibleHeight }) => {
  if (!service) {
    return <Text dimColor>No service selected</Text>;
  }

  const statusColor = service.status === 'running' ? 'green' :
                     service.status === 'stopped' ? 'yellow' : 'red';
  const statusIcon = service.status === 'running' ? '●' :
                    service.status === 'stopped' ? '○' : '✗';

  // Calculate visible portion of logs
  const visibleLines = lines.slice(scrollOffset, scrollOffset + visibleHeight);
  const totalLines = lines.length;
  const canScrollUp = scrollOffset > 0;
  const canScrollDown = scrollOffset + visibleHeight < totalLines;

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="round" borderColor="yellow" paddingX={1} marginBottom={1}>
        <Text bold color="yellow">📋 Logs: {service.name}</Text>
        <Text dimColor> | </Text>
        <Text color={statusColor}>{statusIcon} {service.status}</Text>
        {service.pid && (
          <>
            <Text dimColor> | PID: </Text>
            <Text>{service.pid}</Text>
          </>
        )}
        {service.port && (
          <>
            <Text dimColor> | Port: </Text>
            <Text>{service.port}</Text>
          </>
        )}
        <Text dimColor> | </Text>
        <Text dimColor>Lines: {scrollOffset + 1}-{Math.min(scrollOffset + visibleHeight, totalLines)}/{totalLines}</Text>
        {autoScroll && <Text color="green"> [TAILING]</Text>}
      </Box>

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {canScrollUp && (
          <Text dimColor backgroundColor="gray">▲ More above (↑/PgUp to scroll, g for top)</Text>
        )}
        {lines.length === 0 ? (
          <Text dimColor>No logs available</Text>
        ) : (
          visibleLines.map((line, i) => (
            <Text key={scrollOffset + i}>{line}</Text>
          ))
        )}
        {canScrollDown && (
          <Text dimColor backgroundColor="gray">▼ More below (↓/PgDn to scroll, G for bottom)</Text>
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
    <Box flexDirection="column" height="100%">
      <Box borderStyle="round" borderColor="magenta" paddingX={1} marginBottom={1}>
        <Text bold color="magenta">💬 Chat with {service.name} agent</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
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

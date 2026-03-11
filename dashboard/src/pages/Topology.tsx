import { useRef, useState, useEffect, useCallback } from "preact/hooks"
import { api, HubEvent, TopoNode as ApiTopoNode, TopoEdge as ApiTopoEdge } from "@/api"
import { sseSubscribe } from "@/api/client"
import { cn, timeAgo } from "@/lib/hooks"

const C = {
  bg: "#191919",
  info: "#4a7dfc",
  infoGlow: "#4a7dfcaa",
  success: "#34d399",
  successGlow: "#34d39988",
  warning: "#eab308",
  warningGlow: "#eab30888",
  purple: "#a855f7",
  purpleGlow: "#a855f788",
  destructive: "#f87171",
  cyan: "#06b6d4",
  text: "#f5f5f5",
  textMuted: "#8b8b8b",
  textDim: "#5a5a5a",
  grid: "#2a2a2a",
}

interface TopoNode {
  id: string
  label: string
  type: "agent" | "orchestrator" | "eval" | "service"
  status: "running" | "idle" | "stopped"
  eventCount: number
  lastAction: string
  lastTs: string
  x: number
  y: number
  targetX: number
  targetY: number
  radius: number
  color: string
  glowColor: string
  pulsePhase: number
  reward: number[]
}

interface TopoEdge {
  id: string
  source: string
  target: string
  eventType: string
  active: boolean
  lastFired: number
  color: string
  category: "data" | "success" | "rl"
  particles: FlowParticle[]
}

interface FlowParticle {
  t: number
  speed: number
  size: number
  alpha: number
  trail: { x: number; y: number; a: number }[]
}

interface DetailPanel {
  node: TopoNode
  edges: TopoEdge[]
  recentEvents: { type: string; ts: string; data: string }[]
}

function nodeColor(type: string): { fill: string; glow: string } {
  switch (type) {
    case "orchestrator": return { fill: C.purple, glow: C.purpleGlow }
    case "eval": return { fill: C.warning, glow: C.warningGlow }
    case "service": return { fill: C.success, glow: C.successGlow }
    default: return { fill: C.info, glow: C.infoGlow }
  }
}

function edgeCategoryColor(cat: string): string {
  switch (cat) {
    case "success": return C.success
    case "rl": return C.purple
    default: return C.info
  }
}

function statusColorHex(status: string): string {
  switch (status) {
    case "running": return C.success
    case "idle": return C.warning
    default: return C.textDim
  }
}

function createFallbackTopology(): { nodes: TopoNode[]; edges: TopoEdge[] } {
  const now = Date.now()

  const defs = [
    { id: "telemetry-agent", label: "Telemetry Agent", type: "agent" as const, status: "running" as const, eventCount: 142, lastAction: "telemetry:insight emitted", lastTs: new Date(now - 45000).toISOString(), reward: [0.4, 0.5, 0.6, 0.55, 0.7, 0.65, 0.8] },
    { id: "peter-parker", label: "Peter Parker", type: "orchestrator" as const, status: "running" as const, eventCount: 89, lastAction: "task dispatched to builder", lastTs: new Date(now - 120000).toISOString(), reward: [0.3, 0.4, 0.5, 0.55, 0.6, 0.7, 0.75] },
    { id: "eval-engine", label: "Eval Engine", type: "eval" as const, status: "running" as const, eventCount: 234, lastAction: "eval:scored lobsters-prg-0.6.0", lastTs: new Date(now - 30000).toISOString(), reward: [0.6, 0.5, 0.7, 0.8, 0.75, 0.85, 0.9] },
    { id: "stratus", label: "Stratus API", type: "service" as const, status: "running" as const, eventCount: 1203, lastAction: "rollout prediction served", lastTs: new Date(now - 15000).toISOString(), reward: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8] },
  ]

  const nodes: TopoNode[] = defs.map((d) => {
    const c = nodeColor(d.type)
    return {
      ...d,
      x: 0, y: 0, targetX: 0, targetY: 0,
      radius: d.type === "orchestrator" ? 32 : d.type === "service" ? 28 : 24,
      color: c.fill, glowColor: c.glow,
      pulsePhase: Math.random() * Math.PI * 2,
    }
  })

  const edges: TopoEdge[] = [
    { id: "e1", source: "telemetry-agent", target: "peter-parker", eventType: "telemetry:insight", active: true, lastFired: now - 45000, color: C.info, category: "data", particles: [] },
    { id: "e2", source: "peter-parker", target: "eval-engine", eventType: "peter:task-completed", active: true, lastFired: now - 120000, color: C.purple, category: "rl", particles: [] },
    { id: "e3", source: "eval-engine", target: "telemetry-agent", eventType: "eval:scored", active: true, lastFired: now - 30000, color: C.warning, category: "success", particles: [] },
    { id: "e4", source: "peter-parker", target: "stratus", eventType: "peter:rollout-request", active: true, lastFired: now - 15000, color: C.purple, category: "rl", particles: [] },
    { id: "e5", source: "stratus", target: "eval-engine", eventType: "stratus:prediction", active: true, lastFired: now - 20000, color: C.success, category: "success", particles: [] },
  ]

  for (const edge of edges) {
    const count = edge.active ? 3 + Math.floor(Math.random() * 3) : 1
    for (let i = 0; i < count; i++) {
      edge.particles.push({
        t: Math.random(),
        speed: 0.0008 + Math.random() * 0.0015,
        size: 2.0 + Math.random() * 2.5,
        alpha: 0.5 + Math.random() * 0.5,
        trail: [],
      })
    }
  }

  return { nodes, edges }
}

function transformApiTopology(
  apiNodes: ApiTopoNode[],
  apiEdges: ApiTopoEdge[],
): { nodes: TopoNode[]; edges: TopoEdge[] } {
  const now = Date.now()

  const nodes: TopoNode[] = apiNodes.map((n) => {
    const c = nodeColor(n.type)
    return {
      id: n.id,
      label: n.label,
      type: n.type,
      status: n.status,
      eventCount: n.eventCount || Math.floor(Math.random() * 200) + 50,
      lastAction: `${n.type} activity`,
      lastTs: new Date(now - Math.random() * 300000).toISOString(),
      reward: Array.from({ length: 7 }, () => 0.3 + Math.random() * 0.5),
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      radius: n.type === "orchestrator" ? 32 : n.type === "service" ? 28 : 24,
      color: c.fill,
      glowColor: c.glow,
      pulsePhase: Math.random() * Math.PI * 2,
    }
  })

  const edges: TopoEdge[] = apiEdges.map((e) => {
    const color = e.category === "success" ? C.success
      : e.category === "rl" ? C.purple
      : C.info
    const edge: TopoEdge = {
      id: e.id,
      source: e.source,
      target: e.target,
      eventType: e.eventType,
      active: true,
      lastFired: now - Math.random() * 120000,
      color,
      category: e.category,
      particles: [],
    }
    const count = 3 + Math.floor(Math.random() * 3)
    for (let i = 0; i < count; i++) {
      edge.particles.push({
        t: Math.random(),
        speed: 0.0008 + Math.random() * 0.0015,
        size: 2.0 + Math.random() * 2.5,
        alpha: 0.5 + Math.random() * 0.5,
        trail: [],
      })
    }
    return edge
  })

  return { nodes, edges }
}

function layoutNodes(nodes: TopoNode[], w: number, h: number, edges?: TopoEdge[]) {
  const cx = w / 2
  const cy = h / 2
  const n = nodes.length

  if (n === 0) return

  // Preferred positions for known system nodes
  const scale = Math.min(w / 900, h / 600, 1)
  const knownPositions: Record<string, [number, number]> = {
    "peter-parker": [cx, cy - 100 * scale],
    "telemetry-agent": [cx - 200 * scale, cy - 60 * scale],
    "eval-engine": [cx + 200 * scale, cy + 40 * scale],
    "stratus": [cx + 200 * scale, cy - 120 * scale],
  }

  // For remaining nodes, use circular layout
  const unknownNodes = nodes.filter(node => !knownPositions[node.id])
  const knownNodes = nodes.filter(node => knownPositions[node.id])

  // Place known nodes at their preferred positions
  for (const node of knownNodes) {
    const p = knownPositions[node.id]
    node.targetX = p[0]
    node.targetY = p[1]
    if (node.x === 0 && node.y === 0) {
      node.x = p[0] + (Math.random() - 0.5) * 60
      node.y = p[1] + (Math.random() - 0.5) * 60
    }
  }

  // Place unknown nodes in a circular pattern around the center
  if (unknownNodes.length > 0) {
    const baseRadius = Math.min(w, h) * 0.32
    const angleStep = (2 * Math.PI) / Math.max(unknownNodes.length, 1)
    const startAngle = -Math.PI / 2 + Math.PI / 6 // Start from top, offset slightly

    unknownNodes.forEach((node, i) => {
      const angle = startAngle + i * angleStep
      // Vary radius slightly based on node type
      const radiusOffset = node.type === "orchestrator" ? -20
        : node.type === "service" ? 20
        : 0
      const r = baseRadius + radiusOffset

      node.targetX = cx + Math.cos(angle) * r
      node.targetY = cy + Math.sin(angle) * r

      if (node.x === 0 && node.y === 0) {
        node.x = node.targetX + (Math.random() - 0.5) * 80
        node.y = node.targetY + (Math.random() - 0.5) * 80
      }
    })
  }

  // Apply a simple force-directed adjustment to reduce edge crossings
  // (3 iterations of repulsion)
  if (edges && edges.length > 0) {
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const ni = nodes[i]
          const nj = nodes[j]
          const dx = ni.targetX - nj.targetX
          const dy = ni.targetY - nj.targetY
          const dist = Math.sqrt(dx * dx + dy * dy)
          const minDist = 120

          if (dist < minDist && dist > 0) {
            const force = (minDist - dist) * 0.3
            const fx = (dx / dist) * force
            const fy = (dy / dist) * force

            // Only move nodes that aren't in known positions
            if (!knownPositions[ni.id]) {
              ni.targetX += fx * 0.5
              ni.targetY += fy * 0.5
            }
            if (!knownPositions[nj.id]) {
              nj.targetX -= fx * 0.5
              nj.targetY -= fy * 0.5
            }
          }
        }
      }
    }
  }

  // Clamp to viewport with padding
  const padding = 80
  for (const node of nodes) {
    node.targetX = Math.max(padding, Math.min(w - padding, node.targetX))
    node.targetY = Math.max(padding, Math.min(h - padding, node.targetY))
  }
}

function cubicBezier(sx: number, sy: number, c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number, t: number): [number, number] {
  const u = 1 - t
  return [
    u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
    u * u * u * sy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
  ]
}

function edgeCurve(src: TopoNode, tgt: TopoNode) {
  const dx = tgt.x - src.x
  const dy = tgt.y - src.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  const nx = dist > 0 ? -dy / dist : 0
  const ny = dist > 0 ? dx / dist : 0
  const curve = Math.min(dist * 0.25, 70)
  const mx = (src.x + tgt.x) / 2
  const my = (src.y + tgt.y) / 2
  return {
    sx: src.x, sy: src.y,
    c1x: mx + nx * curve - dx * 0.15,
    c1y: my + ny * curve - dy * 0.15,
    c2x: mx + nx * curve + dx * 0.15,
    c2y: my + ny * curve + dy * 0.15,
    ex: tgt.x, ey: tgt.y,
  }
}

function hexToRGBA(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function distToNode(nx: number, ny: number, mx: number, my: number, radius: number): number {
  return Math.max(0, Math.sqrt((nx - mx) ** 2 + (ny - my) ** 2) - radius)
}

const VERT_QUAD = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

const FRAG_COMPOSITE = `
  precision highp float;
  uniform sampler2D u_scene;
  uniform sampler2D u_bloom;
  uniform vec2 u_resolution;
  uniform float u_time;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec4 scene = texture2D(u_scene, uv);
    vec4 bloom = texture2D(u_bloom, uv);
    vec3 color = scene.rgb + bloom.rgb * 1.2;
    float vignette = 1.0 - 0.4 * length((uv - 0.5) * 1.5);
    color *= vignette;
    float scan = 0.97 + 0.03 * sin(uv.y * u_resolution.y * 1.5 + u_time * 0.5);
    color *= scan;
    color += (hash(uv + u_time * 0.001) - 0.5) * 0.015;
    color = pow(color, vec3(0.95));
    gl_FragColor = vec4(color, 1.0);
  }
`

const FRAG_BLUR_H = `
  precision highp float;
  uniform sampler2D u_texture;
  uniform vec2 u_resolution;
  uniform float u_radius;
  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float texelSize = 1.0 / u_resolution.x;
    vec3 result = vec3(0.0);
    float weights[5];
    weights[0] = 0.227027;
    weights[1] = 0.1945946;
    weights[2] = 0.1216216;
    weights[3] = 0.054054;
    weights[4] = 0.016216;
    result += texture2D(u_texture, uv).rgb * weights[0];
    for (int i = 1; i < 5; i++) {
      float offset = float(i) * texelSize * u_radius;
      result += texture2D(u_texture, uv + vec2(offset, 0.0)).rgb * weights[i];
      result += texture2D(u_texture, uv - vec2(offset, 0.0)).rgb * weights[i];
    }
    gl_FragColor = vec4(result, 1.0);
  }
`

const FRAG_BLUR_V = `
  precision highp float;
  uniform sampler2D u_texture;
  uniform vec2 u_resolution;
  uniform float u_radius;
  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float texelSize = 1.0 / u_resolution.y;
    vec3 result = vec3(0.0);
    float weights[5];
    weights[0] = 0.227027;
    weights[1] = 0.1945946;
    weights[2] = 0.1216216;
    weights[3] = 0.054054;
    weights[4] = 0.016216;
    result += texture2D(u_texture, uv).rgb * weights[0];
    for (int i = 1; i < 5; i++) {
      float offset = float(i) * texelSize * u_radius;
      result += texture2D(u_texture, uv + vec2(0.0, offset)).rgb * weights[i];
      result += texture2D(u_texture, uv - vec2(0.0, offset)).rgb * weights[i];
    }
    gl_FragColor = vec4(result, 1.0);
  }
`

const FRAG_THRESHOLD = `
  precision highp float;
  uniform sampler2D u_texture;
  uniform vec2 u_resolution;
  uniform float u_threshold;
  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec4 color = texture2D(u_texture, uv);
    float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    float contribution = smoothstep(u_threshold, u_threshold + 0.15, brightness);
    gl_FragColor = vec4(color.rgb * contribution * 1.5, 1.0);
  }
`

function compileShader(gl: WebGLRenderingContext, source: string, type: number): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createProgram(gl: WebGLRenderingContext, vertSrc: string, fragSrc: string): WebGLProgram | null {
  const vert = compileShader(gl, vertSrc, gl.VERTEX_SHADER)
  const frag = compileShader(gl, fragSrc, gl.FRAGMENT_SHADER)
  if (!vert || !frag) return null
  const prog = gl.createProgram()
  if (!prog) return null
  gl.attachShader(prog, vert)
  gl.attachShader(prog, frag)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(prog))
    return null
  }
  return prog
}

function createFBO(gl: WebGLRenderingContext, w: number, h: number) {
  const fb = gl.createFramebuffer()
  const tex = gl.createTexture()
  if (!fb || !tex) return null
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { fb, tex }
}

function drawGridDots(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  const spacing = 50
  ctx.fillStyle = C.grid
  for (let x = spacing; x < w; x += spacing) {
    for (let y = spacing; y < h; y += spacing) {
      const dist = Math.sqrt((x - w / 2) ** 2 + (y - h / 2) ** 2)
      const pulse = Math.sin(time * 0.0003 + dist * 0.004) * 0.3 + 0.7
      ctx.globalAlpha = 0.12 * pulse
      ctx.beginPath()
      ctx.arc(x, y, 0.8, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  nodes: TopoNode[],
  edges: TopoEdge[],
  hoveredId: string | null,
  selectedId: string | null,
  time: number,
) {
  ctx.clearRect(0, 0, w, h)

  const connectedNodes = new Set<string>()
  const connectedEdges = new Set<string>()
  const focusId = hoveredId || selectedId
  if (focusId) {
    for (const e of edges) {
      if (e.source === focusId || e.target === focusId) {
        connectedNodes.add(e.source)
        connectedNodes.add(e.target)
        connectedEdges.add(e.id)
      }
    }
  }

  drawGridDots(ctx, w, h, time)

  for (const edge of edges) {
    const src = nodes.find((n) => n.id === edge.source)
    const tgt = nodes.find((n) => n.id === edge.target)
    if (!src || !tgt) continue

    const highlighted = connectedEdges.has(edge.id)
    const dimmed = connectedEdges.size > 0 && !highlighted

    const { sx, sy, c1x, c1y, c2x, c2y, ex, ey } = edgeCurve(src, tgt)
    const timeSince = Date.now() - edge.lastFired
    const recentFire = timeSince < 5000
    const fireIntensity = recentFire ? 1 - timeSince / 5000 : 0
    const baseAlpha = edge.active ? (highlighted ? 0.8 : 0.35) : 0.08
    const alpha = dimmed ? 0.05 : Math.min(1, baseAlpha + fireIntensity * 0.5)

    ctx.save()
    ctx.globalAlpha = alpha * 0.4
    ctx.strokeStyle = edge.color
    ctx.shadowColor = edge.color
    ctx.shadowBlur = highlighted ? 20 : recentFire ? 14 : 8
    ctx.lineWidth = highlighted ? 5 : 3
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey)
    ctx.stroke()
    ctx.restore()

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.strokeStyle = edge.color
    ctx.lineWidth = highlighted ? 2.5 : 1.2
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey)
    ctx.stroke()
    ctx.restore()

    const arrowT = 0.88
    const [ax, ay] = cubicBezier(sx, sy, c1x, c1y, c2x, c2y, ex, ey, arrowT)
    const [bx, by] = cubicBezier(sx, sy, c1x, c1y, c2x, c2y, ex, ey, arrowT + 0.04)
    const angle = Math.atan2(by - ay, bx - ax)
    const aSize = highlighted ? 9 : 6
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.fillStyle = edge.color
    ctx.shadowColor = edge.color
    ctx.shadowBlur = 6
    ctx.translate(bx, by)
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(-aSize * 1.2, -aSize * 0.5)
    ctx.lineTo(-aSize * 1.2, aSize * 0.5)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    if (edge.active || recentFire) {
      for (const p of edge.particles) {
        const pAlpha = dimmed ? 0.05 : p.alpha * (highlighted ? 1.0 : 0.6)

        for (let ti = p.trail.length - 1; ti >= 0; ti--) {
          const tr = p.trail[ti]
          ctx.save()
          ctx.globalAlpha = tr.a * pAlpha * 0.3
          ctx.fillStyle = edge.color
          ctx.shadowColor = edge.color
          ctx.shadowBlur = p.size * 2
          ctx.beginPath()
          ctx.arc(tr.x, tr.y, p.size * (1 - ti * 0.1), 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }

        const [px, py] = cubicBezier(sx, sy, c1x, c1y, c2x, c2y, ex, ey, p.t)

        ctx.save()
        ctx.globalAlpha = pAlpha
        ctx.fillStyle = "#ffffff"
        ctx.shadowColor = edge.color
        ctx.shadowBlur = p.size * 6
        ctx.beginPath()
        ctx.arc(px, py, p.size * 0.6, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()

        ctx.save()
        ctx.globalAlpha = pAlpha * 0.7
        ctx.fillStyle = edge.color
        ctx.shadowColor = edge.color
        ctx.shadowBlur = p.size * 10
        ctx.beginPath()
        ctx.arc(px, py, p.size * 1.2, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }
  }

  for (const node of nodes) {
    const isHovered = hoveredId === node.id
    const isSelected = selectedId === node.id
    const dimmed = connectedNodes.size > 0 && !connectedNodes.has(node.id) && !isHovered && !isSelected
    const nodeAlpha = dimmed ? 0.15 : 1.0

    const breathe = Math.sin(time * 0.002 + node.pulsePhase) * 0.15 + 0.85
    const r = node.radius * (isHovered ? 1.15 : isSelected ? 1.1 : 1.0)

    if (node.status === "running" || isHovered || isSelected) {
      const glowR = r * (isSelected ? 3.5 : isHovered ? 3.0 : 2.2) * breathe
      const grad = ctx.createRadialGradient(node.x, node.y, r * 0.5, node.x, node.y, glowR)
      grad.addColorStop(0, hexToRGBA(node.color, 0.25 * nodeAlpha))
      grad.addColorStop(0.5, hexToRGBA(node.color, 0.08 * nodeAlpha))
      grad.addColorStop(1, hexToRGBA(node.color, 0))
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2)
      ctx.fill()
    }

    if (node.status === "running") {
      const ringAlpha = (Math.sin(time * 0.003 + node.pulsePhase) * 0.3 + 0.5) * nodeAlpha
      const ringR = r * (1.5 + Math.sin(time * 0.001 + node.pulsePhase * 2) * 0.3)
      ctx.save()
      ctx.globalAlpha = ringAlpha * 0.3
      ctx.strokeStyle = node.color
      ctx.lineWidth = 1
      ctx.setLineDash([4, 6])
      ctx.beginPath()
      ctx.arc(node.x, node.y, ringR, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }

    const innerGrad = ctx.createRadialGradient(node.x - r * 0.2, node.y - r * 0.2, 0, node.x, node.y, r)
    innerGrad.addColorStop(0, hexToRGBA(node.color, 0.3 * nodeAlpha))
    innerGrad.addColorStop(0.7, hexToRGBA(node.color, 0.12 * nodeAlpha))
    innerGrad.addColorStop(1, hexToRGBA(node.color, 0.05 * nodeAlpha))

    ctx.save()
    ctx.fillStyle = innerGrad
    ctx.shadowColor = node.color
    ctx.shadowBlur = isSelected ? 25 : isHovered ? 18 : 10
    ctx.globalAlpha = nodeAlpha
    ctx.beginPath()
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.globalAlpha = nodeAlpha * (isSelected ? 0.9 : isHovered ? 0.7 : 0.4)
    ctx.strokeStyle = node.color
    ctx.lineWidth = isSelected ? 2 : 1.2
    ctx.beginPath()
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()

    const coreGrad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 0.35)
    coreGrad.addColorStop(0, hexToRGBA("#ffffff", 0.6 * nodeAlpha * breathe))
    coreGrad.addColorStop(0.5, hexToRGBA(node.color, 0.4 * nodeAlpha * breathe))
    coreGrad.addColorStop(1, hexToRGBA(node.color, 0))
    ctx.fillStyle = coreGrad
    ctx.beginPath()
    ctx.arc(node.x, node.y, r * 0.35, 0, Math.PI * 2)
    ctx.fill()
  }
}

function Sparkline({ data, color, width = 48, height = 16 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 2) - 1
    return `${x},${y}`
  }).join(" ")
  const lastY = height - ((data[data.length - 1] - min) / range) * (height - 2) - 1

  return (
    <svg width={width} height={height} class="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        opacity="0.7"
      />
      <circle cx={String(width)} cy={String(lastY)} r="2" fill={color}>
        <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  )
}

export function TopologyPage() {
  const glCanvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<number>(0)
  const webglActiveRef = useRef(true)

  const stateRef = useRef<{
    nodes: TopoNode[]
    edges: TopoEdge[]
    hoveredNode: string | null
    selectedNode: string | null
    dragging: string | null
    dragOffset: { x: number; y: number }
    mouse: { x: number; y: number }
    time: number
    liveEventQueue: HubEvent[]
    offscreenCanvas: HTMLCanvasElement | null
    offscreenCtx: CanvasRenderingContext2D | null
    gl: WebGLRenderingContext | null
    programs: {
      threshold: WebGLProgram | null
      blurH: WebGLProgram | null
      blurV: WebGLProgram | null
      composite: WebGLProgram | null
    }
    fbos: {
      scene: ReturnType<typeof createFBO>
      bright: ReturnType<typeof createFBO>
      pingpong: [ReturnType<typeof createFBO>, ReturnType<typeof createFBO>]
    }
    quadVBO: WebGLBuffer | null
    sceneTexture: WebGLTexture | null
    fboWidth: number
    fboHeight: number
  }>({
    nodes: [], edges: [],
    hoveredNode: null, selectedNode: null,
    dragging: null, dragOffset: { x: 0, y: 0 },
    mouse: { x: 0, y: 0 }, time: 0,
    liveEventQueue: [],
    offscreenCanvas: null, offscreenCtx: null,
    gl: null,
    programs: { threshold: null, blurH: null, blurV: null, composite: null },
    fbos: { scene: null, bright: null, pingpong: [null, null] },
    quadVBO: null, sceneTexture: null,
    fboWidth: 0, fboHeight: 0,
  })

  const [selectedDetail, setSelectedDetail] = useState<DetailPanel | null>(null)
  const [liveConnected, setLiveConnected] = useState(false)
  const [eventLog, setEventLog] = useState<{ type: string; ts: string }[]>([])
  const [, forceRender] = useState(0)

  const selectNode = useCallback((node: TopoNode | null) => {
    const st = stateRef.current
    if (!node || st.selectedNode === node.id) {
      st.selectedNode = null
      setSelectedDetail(null)
    } else {
      st.selectedNode = node.id
      const connEdges = st.edges.filter((e) => e.source === node.id || e.target === node.id)
      setSelectedDetail({
        node,
        edges: connEdges,
        recentEvents: connEdges.slice(0, 5).map((e) => ({
          type: e.eventType,
          ts: new Date(e.lastFired).toISOString(),
          data: `${e.source} -> ${e.target}`,
        })),
      })
    }
  }, [])

  useEffect(() => {
    const glCanvas = glCanvasRef.current
    const container = containerRef.current
    if (!glCanvas || !container) return

    const offscreen = document.createElement("canvas")
    const ctx2d = offscreen.getContext("2d")
    if (!ctx2d) return

    const st = stateRef.current
    st.offscreenCanvas = offscreen
    st.offscreenCtx = ctx2d

    const gl = glCanvas.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false })

    if (gl) {
      st.gl = gl
      st.programs.threshold = createProgram(gl, VERT_QUAD, FRAG_THRESHOLD)
      st.programs.blurH = createProgram(gl, VERT_QUAD, FRAG_BLUR_H)
      st.programs.blurV = createProgram(gl, VERT_QUAD, FRAG_BLUR_V)
      st.programs.composite = createProgram(gl, VERT_QUAD, FRAG_COMPOSITE)

      const quadVerts = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
      const vbo = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
      gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW)
      st.quadVBO = vbo
      st.sceneTexture = gl.createTexture()
      webglActiveRef.current = true
    } else {
      webglActiveRef.current = false
    }

    const setupFBOs = (w: number, h: number) => {
      if (!gl) return
      const bw = Math.floor(w / 2)
      const bh = Math.floor(h / 2)
      st.fbos.scene = createFBO(gl, w, h)
      st.fbos.bright = createFBO(gl, bw, bh)
      st.fbos.pingpong = [createFBO(gl, bw, bh), createFBO(gl, bw, bh)]
      st.fboWidth = w
      st.fboHeight = h
    }

    const resize = () => {
      const rect = container.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.floor(rect.width * dpr)
      const h = Math.floor(rect.height * dpr)

      glCanvas.width = w
      glCanvas.height = h
      glCanvas.style.width = rect.width + "px"
      glCanvas.style.height = rect.height + "px"

      offscreen.width = w
      offscreen.height = h

      if (gl) {
        gl.viewport(0, 0, w, h)
        setupFBOs(w, h)
      }

      if (st.nodes.length === 0) {
        // Try to fetch from API, fallback to mock data
        api.topology()
          .then(({ nodes: apiNodes, edges: apiEdges }) => {
            if (apiNodes.length > 0) {
              const { nodes, edges } = transformApiTopology(apiNodes, apiEdges)
              st.nodes = nodes
              st.edges = edges
              setLiveConnected(true)
            } else {
              const { nodes, edges } = createFallbackTopology()
              st.nodes = nodes
              st.edges = edges
            }
            const rect2 = container.getBoundingClientRect()
            layoutNodes(st.nodes, rect2.width, rect2.height, st.edges)
            forceRender((n) => n + 1)
          })
          .catch(() => {
            const { nodes, edges } = createFallbackTopology()
            st.nodes = nodes
            st.edges = edges
            layoutNodes(st.nodes, rect.width, rect.height, st.edges)
            forceRender((n) => n + 1)
          })
      } else {
        layoutNodes(st.nodes, rect.width, rect.height, st.edges)
        forceRender((n) => n + 1)
      }
    }

    resize()
    window.addEventListener("resize", resize)

    const handleMouseMove = (e: MouseEvent) => {
      const rect = glCanvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      st.mouse = { x: mx, y: my }

      if (st.dragging) {
        const node = st.nodes.find((n) => n.id === st.dragging)
        if (node) {
          node.x = mx - st.dragOffset.x
          node.y = my - st.dragOffset.y
          node.targetX = node.x
          node.targetY = node.y
        }
        return
      }

      let closest: TopoNode | null = null
      let closestDist = Infinity
      for (const n of st.nodes) {
        const d = distToNode(n.x, n.y, mx, my, n.radius * 1.5)
        if (d < closestDist && d < 20) {
          closestDist = d
          closest = n
        }
      }
      st.hoveredNode = closest?.id || null
      glCanvas.style.cursor = closest ? "pointer" : "default"
    }

    const handleMouseDown = (e: MouseEvent) => {
      const rect = glCanvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top

      let hit: TopoNode | null = null
      for (const n of st.nodes) {
        if (distToNode(n.x, n.y, mx, my, n.radius * 1.5) < 5) {
          hit = n
          break
        }
      }
      if (hit) {
        st.dragging = hit.id
        st.dragOffset = { x: mx - hit.x, y: my - hit.y }
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      const wasDragging = st.dragging
      const rect = glCanvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top

      if (wasDragging) {
        const node = st.nodes.find((n) => n.id === wasDragging)
        st.dragging = null
        if (node) {
          const movedDist = Math.sqrt(
            (mx - (st.dragOffset.x + node.targetX)) ** 2 +
            (my - (st.dragOffset.y + node.targetY)) ** 2
          )
          if (movedDist < 5) {
            selectNode(node)
          }
        }
        return
      }

      let hit: TopoNode | null = null
      for (const n of st.nodes) {
        if (distToNode(n.x, n.y, mx, my, n.radius * 1.5) < 5) {
          hit = n
          break
        }
      }
      if (hit) {
        selectNode(hit)
      } else {
        st.selectedNode = null
        setSelectedDetail(null)
      }
    }

    glCanvas.addEventListener("mousemove", handleMouseMove)
    glCanvas.addEventListener("mousedown", handleMouseDown)
    glCanvas.addEventListener("mouseup", handleMouseUp)

    function drawQuad(program: WebGLProgram) {
      if (!gl || !st.quadVBO) return
      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, st.quadVBO)
      const posLoc = gl.getAttribLocation(program, "a_position")
      gl.enableVertexAttribArray(posLoc)
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    let lastTime = performance.now()
    const render = (now: number) => {
      const dt = now - lastTime
      lastTime = now
      st.time = now

      for (const n of st.nodes) {
        if (st.dragging !== n.id) {
          n.x += (n.targetX - n.x) * 0.06
          n.y += (n.targetY - n.y) * 0.06
        }
      }

      for (const edge of st.edges) {
        if (!edge.active && Date.now() - edge.lastFired > 10000) continue
        const src = st.nodes.find((n) => n.id === edge.source)
        const tgt = st.nodes.find((n) => n.id === edge.target)
        if (!src || !tgt) continue
        const curve = edgeCurve(src, tgt)

        for (const p of edge.particles) {
          p.t += p.speed * (dt / 16)
          if (p.t > 1) {
            p.t -= 1
            p.speed = 0.0008 + Math.random() * 0.0015
            p.trail = []
          }

          const [px, py] = cubicBezier(curve.sx, curve.sy, curve.c1x, curve.c1y, curve.c2x, curve.c2y, curve.ex, curve.ey, p.t)
          p.trail.unshift({ x: px, y: py, a: p.alpha })
          if (p.trail.length > 8) p.trail.pop()
          for (let i = 0; i < p.trail.length; i++) {
            p.trail[i].a *= 0.82
          }
        }
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = container.getBoundingClientRect()
      const cw = rect.width
      const ch = rect.height

      if (ctx2d) {
        ctx2d.save()
        ctx2d.scale(dpr, dpr)
        drawScene(ctx2d, cw, ch, st.nodes, st.edges, st.hoveredNode, st.selectedNode, now)
        ctx2d.restore()
      }

      if (gl && webglActiveRef.current && st.sceneTexture && st.fbos.scene && st.fbos.bright && st.fbos.pingpong[0] && st.fbos.pingpong[1]) {
        const fw = st.fboWidth
        const fh = st.fboHeight
        const bw = Math.floor(fw / 2)
        const bh = Math.floor(fh / 2)

        gl.bindTexture(gl.TEXTURE_2D, st.sceneTexture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offscreen)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

        if (st.programs.threshold) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbos.bright.fb)
          gl.viewport(0, 0, bw, bh)
          gl.useProgram(st.programs.threshold)
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, st.sceneTexture)
          gl.uniform1i(gl.getUniformLocation(st.programs.threshold, "u_texture"), 0)
          gl.uniform2f(gl.getUniformLocation(st.programs.threshold, "u_resolution"), bw, bh)
          gl.uniform1f(gl.getUniformLocation(st.programs.threshold, "u_threshold"), 0.18)
          drawQuad(st.programs.threshold)
        }

        const blurPasses = 4
        for (let pass = 0; pass < blurPasses; pass++) {
          const radius = 2.0 + pass * 1.5

          if (st.programs.blurH) {
            const srcFBO = pass === 0 ? st.fbos.bright : st.fbos.pingpong[1]
            gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbos.pingpong[0]!.fb)
            gl.viewport(0, 0, bw, bh)
            gl.useProgram(st.programs.blurH)
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, srcFBO!.tex)
            gl.uniform1i(gl.getUniformLocation(st.programs.blurH, "u_texture"), 0)
            gl.uniform2f(gl.getUniformLocation(st.programs.blurH, "u_resolution"), bw, bh)
            gl.uniform1f(gl.getUniformLocation(st.programs.blurH, "u_radius"), radius)
            drawQuad(st.programs.blurH)
          }

          if (st.programs.blurV) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbos.pingpong[1]!.fb)
            gl.viewport(0, 0, bw, bh)
            gl.useProgram(st.programs.blurV)
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, st.fbos.pingpong[0]!.tex)
            gl.uniform1i(gl.getUniformLocation(st.programs.blurV, "u_texture"), 0)
            gl.uniform2f(gl.getUniformLocation(st.programs.blurV, "u_resolution"), bw, bh)
            gl.uniform1f(gl.getUniformLocation(st.programs.blurV, "u_radius"), radius)
            drawQuad(st.programs.blurV)
          }
        }

        if (st.programs.composite) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
          gl.viewport(0, 0, fw, fh)
          gl.useProgram(st.programs.composite)
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, st.sceneTexture)
          gl.uniform1i(gl.getUniformLocation(st.programs.composite, "u_scene"), 0)
          gl.activeTexture(gl.TEXTURE1)
          gl.bindTexture(gl.TEXTURE_2D, st.fbos.pingpong[1]!.tex)
          gl.uniform1i(gl.getUniformLocation(st.programs.composite, "u_bloom"), 1)
          gl.uniform2f(gl.getUniformLocation(st.programs.composite, "u_resolution"), fw, fh)
          gl.uniform1f(gl.getUniformLocation(st.programs.composite, "u_time"), now * 0.001)
          drawQuad(st.programs.composite)
        }
      } else if (!webglActiveRef.current) {
        const fallbackCtx = glCanvas.getContext("2d")
        if (fallbackCtx && offscreen) {
          fallbackCtx.clearRect(0, 0, glCanvas.width, glCanvas.height)
          fallbackCtx.drawImage(offscreen, 0, 0)
        }
      }

      animRef.current = requestAnimationFrame(render)
    }

    animRef.current = requestAnimationFrame(render)

    let unsub: (() => void) | null = null
    try {
      unsub = sseSubscribe("/api/events/stream", (event) => {
        setLiveConnected(true)
        const evt = event as HubEvent
        setEventLog((prev) => [{ type: evt.type, ts: evt.ts }, ...prev].slice(0, 20))

        for (const edge of st.edges) {
          if (evt.type === edge.eventType || evt.type.startsWith(edge.eventType.split(":")[0] + ":")) {
            edge.lastFired = Date.now()
            edge.active = true
            edge.particles.push({
              t: 0,
              speed: 0.003 + Math.random() * 0.002,
              size: 3.5,
              alpha: 1,
              trail: [],
            })
            setTimeout(() => {
              if (edge.particles.length > 10) edge.particles.shift()
            }, 3000)
          }
        }
      })
    } catch {}

    return () => {
      window.removeEventListener("resize", resize)
      glCanvas.removeEventListener("mousemove", handleMouseMove)
      glCanvas.removeEventListener("mousedown", handleMouseDown)
      glCanvas.removeEventListener("mouseup", handleMouseUp)
      cancelAnimationFrame(animRef.current)
      unsub?.()
    }
  }, [selectNode])

  const st = stateRef.current

  return (
    <div class="flex h-[calc(100vh-3rem)] gap-0">
      <div ref={containerRef} class="flex-1 relative overflow-hidden" style={{ background: C.bg }}>
        <style>{`
          @keyframes topo-breathe {
            0%, 100% { opacity: 0.25; }
            50% { opacity: 0.5; }
          }
          @keyframes topo-float-1 {
            0%, 100% { transform: translate(0, 0) scale(1); }
            33% { transform: translate(25px, -18px) scale(1.05); }
            66% { transform: translate(-12px, 14px) scale(0.95); }
          }
          @keyframes topo-float-2 {
            0%, 100% { transform: translate(0, 0) scale(1); }
            33% { transform: translate(-30px, 12px) scale(1.08); }
            66% { transform: translate(18px, -24px) scale(0.92); }
          }
          @keyframes topo-float-3 {
            0%, 100% { transform: translate(0, 0) scale(1); }
            33% { transform: translate(14px, 22px) scale(0.96); }
            66% { transform: translate(-22px, -14px) scale(1.04); }
          }
          .topo-orb-1 { animation: topo-float-1 12s ease-in-out infinite; }
          .topo-orb-2 { animation: topo-float-2 15s ease-in-out infinite; }
          .topo-orb-3 { animation: topo-float-3 18s ease-in-out infinite; }
          @keyframes topo-status-pulse {
            0%, 100% { box-shadow: 0 0 4px currentColor; opacity: 1; }
            50% { box-shadow: 0 0 10px currentColor; opacity: 0.7; }
          }
          .topo-status-pulse { animation: topo-status-pulse 2s ease-in-out infinite; }
        `}</style>

        <div class="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
          <div
            class="absolute rounded-full topo-orb-1"
            style={{
              width: "360px", height: "360px",
              left: "12%", top: "18%",
              background: `radial-gradient(circle, ${hexToRGBA(C.info, 0.06)} 0%, transparent 70%)`,
              filter: "blur(40px)",
            }}
          />
          <div
            class="absolute rounded-full topo-orb-2"
            style={{
              width: "400px", height: "400px",
              right: "10%", bottom: "15%",
              background: `radial-gradient(circle, ${hexToRGBA(C.purple, 0.05)} 0%, transparent 70%)`,
              filter: "blur(50px)",
            }}
          />
          <div
            class="absolute rounded-full topo-orb-3"
            style={{
              width: "280px", height: "280px",
              left: "45%", top: "40%",
              background: `radial-gradient(circle, ${hexToRGBA(C.cyan, 0.04)} 0%, transparent 70%)`,
              filter: "blur(35px)",
            }}
          />
        </div>

        <canvas ref={glCanvasRef} class="absolute inset-0 w-full h-full" style={{ zIndex: 1 }} />

        {st.nodes.length > 0 && (
          <div class="absolute inset-0 pointer-events-none" style={{ zIndex: 2 }}>
            {st.nodes.map((node) => {
              const isHovered = st.hoveredNode === node.id
              const isSelected = st.selectedNode === node.id
              const focusId = st.hoveredNode || st.selectedNode
              const connectedNodes = new Set<string>()
              if (focusId) {
                for (const e of st.edges) {
                  if (e.source === focusId || e.target === focusId) {
                    connectedNodes.add(e.source)
                    connectedNodes.add(e.target)
                  }
                }
              }
              const dimmed = connectedNodes.size > 0 && !connectedNodes.has(node.id) && !isHovered && !isSelected

              return (
                <div
                  key={node.id}
                  class="absolute pointer-events-auto"
                  style={{
                    left: `${node.x}px`,
                    top: `${node.y + node.radius + 14}px`,
                    transform: "translateX(-50%)",
                    transition: "opacity 0.3s ease, transform 0.2s ease",
                    opacity: dimmed ? 0.15 : isHovered || isSelected ? 1 : 0.8,
                  }}
                >
                  <div style={{
                    background: isSelected ? "rgba(18, 18, 22, 0.92)" : "rgba(18, 18, 22, 0.75)",
                    backdropFilter: "blur(16px)",
                    WebkitBackdropFilter: "blur(16px)",
                    border: `1px solid ${isSelected ? node.color + "55" : isHovered ? node.color + "33" : "rgba(255,255,255,0.06)"}`,
                    borderRadius: "10px",
                    padding: "8px 12px",
                    whiteSpace: "nowrap",
                    boxShadow: isSelected
                      ? `0 0 24px ${node.color}22, 0 4px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)`
                      : "0 2px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
                    transition: "border-color 0.25s ease, box-shadow 0.3s ease",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                      <span
                        class={cn("topo-status-pulse")}
                        style={{
                          width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0,
                          backgroundColor: statusColorHex(node.status),
                          color: statusColorHex(node.status),
                          display: node.status === "running" ? "block" : "block",
                          boxShadow: node.status === "running" ? undefined : "none",
                          animation: node.status === "running" ? undefined : "none",
                        }}
                      />
                      <span style={{ fontSize: "11px", fontWeight: 600, color: C.text }}>
                        {node.label}
                      </span>
                      <span style={{
                        fontSize: "8px",
                        fontFamily: "'JetBrains Mono', monospace",
                        padding: "1px 5px",
                        borderRadius: "4px",
                        backgroundColor: `${node.color}18`,
                        color: node.color,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}>
                        {node.type}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "5px", gap: "8px" }}>
                      <span style={{ fontSize: "9px", fontFamily: "'JetBrains Mono', monospace", color: C.textMuted }}>
                        {node.eventCount} events
                      </span>
                      <Sparkline data={node.reward} color={node.color} width={48} height={14} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {st.edges.length > 0 && (
          <div class="absolute inset-0 pointer-events-none" style={{ zIndex: 3 }}>
            {st.edges.map((edge) => {
              const src = st.nodes.find((n) => n.id === edge.source)
              const tgt = st.nodes.find((n) => n.id === edge.target)
              if (!src || !tgt) return null

              const isConnected = st.hoveredNode === edge.source || st.hoveredNode === edge.target ||
                                  st.selectedNode === edge.source || st.selectedNode === edge.target
              if (!isConnected) return null

              const curve = edgeCurve(src, tgt)
              const [mx, my] = cubicBezier(curve.sx, curve.sy, curve.c1x, curve.c1y, curve.c2x, curve.c2y, curve.ex, curve.ey, 0.5)

              return (
                <div
                  key={edge.id}
                  class="absolute"
                  style={{
                    left: `${mx}px`,
                    top: `${my}px`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  <span style={{
                    fontSize: "8px",
                    fontFamily: "'JetBrains Mono', monospace",
                    padding: "2px 6px",
                    borderRadius: "5px",
                    color: edge.color,
                    background: "rgba(15, 15, 18, 0.88)",
                    border: `1px solid ${edge.color}33`,
                    backdropFilter: "blur(6px)",
                    letterSpacing: "0.05em",
                  }}>
                    {edge.eventType}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        <div class="absolute top-5 left-5 flex items-center gap-3" style={{ zIndex: 10 }}>
          <h1 class="text-base font-semibold tracking-tight" style={{ color: C.text }}>
            Agent Topology
          </h1>
          <span class={cn(
            "text-[9px] mono px-2 py-0.5 rounded-full tracking-widest uppercase",
            liveConnected ? "text-success" : "text-muted-foreground"
          )} style={{
            background: liveConnected ? "rgba(52, 211, 153, 0.1)" : "rgba(90, 90, 90, 0.2)",
            border: `1px solid ${liveConnected ? "rgba(52, 211, 153, 0.2)" : "rgba(90, 90, 90, 0.15)"}`,
          }}>
            {liveConnected ? "LIVE" : "MOCK"}
          </span>
        </div>

        <div class="absolute bottom-5 left-5 flex items-center gap-5" style={{ zIndex: 10 }}>
          {[
            { color: C.info, label: "Agent" },
            { color: C.purple, label: "Orchestrator" },
            { color: C.warning, label: "Eval" },
            { color: C.success, label: "Service" },
          ].map((item) => (
            <div key={item.label} class="flex items-center gap-1.5">
              <span class="w-[6px] h-[6px] rounded-full" style={{
                backgroundColor: item.color,
                boxShadow: `0 0 6px ${item.color}88`,
              }} />
              <span class="text-[9px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                {item.label}
              </span>
            </div>
          ))}
        </div>

        <div class="absolute bottom-5 flex items-center gap-4" style={{
          zIndex: 10,
          right: selectedDetail ? "336px" : "20px",
          transition: "right 0.3s ease",
        }}>
          {[
            { color: C.info, label: "Data" },
            { color: C.success, label: "Success" },
            { color: C.purple, label: "RL" },
          ].map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <svg width="20" height="4" style={{ flexShrink: 0 }}>
                <line x1="0" y1="2" x2="20" y2="2" stroke={item.color} stroke-width="1.5" stroke-dasharray="6 4" />
              </svg>
              <span class="text-[9px]" style={{ color: C.textMuted }}>{item.label}</span>
            </div>
          ))}
        </div>

        {eventLog.length > 0 && (
          <div class="absolute bottom-5 max-w-60" style={{
            zIndex: 10,
            right: selectedDetail ? "336px" : "20px",
            bottom: "40px",
            transition: "right 0.3s ease",
          }}>
            <div class="text-[9px] uppercase tracking-widest font-medium mb-1.5" style={{ color: C.textDim }}>
              Live Events
            </div>
            <div class="space-y-0.5 max-h-28 overflow-hidden">
              {eventLog.slice(0, 6).map((evt, i) => (
                <div
                  key={`${evt.ts}-${i}`}
                  class="text-[9px] mono truncate animate-fade-in"
                  style={{ opacity: 1 - i * 0.14, color: C.textDim }}
                >
                  <span style={{ color: C.info }}>{evt.type}</span>{" "}
                  <span style={{ opacity: 0.5 }}>{timeAgo(evt.ts)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {selectedDetail && (
        <div
          class="w-80 overflow-y-auto animate-slide-in"
          style={{
            background: "rgba(18, 18, 22, 0.95)",
            borderLeft: "1px solid rgba(60, 60, 60, 0.2)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            flexShrink: 0,
          }}
        >
          <div class="p-4" style={{ borderBottom: "1px solid rgba(60, 60, 60, 0.2)" }}>
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2.5">
                <span class="w-3 h-3 rounded-full" style={{
                  backgroundColor: selectedDetail.node.color,
                  boxShadow: `0 0 10px ${selectedDetail.node.color}66`,
                }} />
                <h2 class="font-semibold text-sm" style={{ color: C.text }}>
                  {selectedDetail.node.label}
                </h2>
              </div>
              <button
                onClick={() => {
                  stateRef.current.selectedNode = null
                  setSelectedDetail(null)
                }}
                class="p-1 rounded transition-colors"
                style={{ color: C.textMuted, background: "none", border: "none", cursor: "pointer" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="flex items-center gap-2">
              <span class="text-[9px] mono px-2 py-0.5 rounded-full uppercase tracking-wider" style={{
                backgroundColor: statusColorHex(selectedDetail.node.status) + "15",
                color: statusColorHex(selectedDetail.node.status),
                border: `1px solid ${statusColorHex(selectedDetail.node.status)}22`,
              }}>
                {selectedDetail.node.status}
              </span>
              <span class="text-[9px] mono px-2 py-0.5 rounded-full uppercase tracking-wider" style={{
                backgroundColor: selectedDetail.node.color + "15",
                color: selectedDetail.node.color,
                border: `1px solid ${selectedDetail.node.color}22`,
              }}>
                {selectedDetail.node.type}
              </span>
            </div>
          </div>

          <div class="p-4 space-y-5">
            <div>
              <div class="text-[9px] uppercase tracking-widest font-medium mb-2.5" style={{ color: C.textDim }}>
                Stats
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div class="rounded-lg p-3" style={{ background: "rgba(40, 40, 44, 0.4)", border: "1px solid rgba(60, 60, 60, 0.15)" }}>
                  <div class="text-[9px] uppercase tracking-wider" style={{ color: C.textDim }}>Events</div>
                  <div class="text-lg font-semibold mono tabular-nums mt-1" style={{ color: C.text }}>
                    {selectedDetail.node.eventCount}
                  </div>
                </div>
                <div class="rounded-lg p-3" style={{ background: "rgba(40, 40, 44, 0.4)", border: "1px solid rgba(60, 60, 60, 0.15)" }}>
                  <div class="text-[9px] uppercase tracking-wider" style={{ color: C.textDim }}>Connections</div>
                  <div class="text-lg font-semibold mono tabular-nums mt-1" style={{ color: C.text }}>
                    {selectedDetail.edges.length}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div class="text-[9px] uppercase tracking-widest font-medium mb-2" style={{ color: C.textDim }}>
                Reward Signal
              </div>
              <div class="rounded-lg p-3" style={{ background: "rgba(40, 40, 44, 0.4)", border: "1px solid rgba(60, 60, 60, 0.15)" }}>
                <Sparkline data={selectedDetail.node.reward} color={selectedDetail.node.color} width={220} height={40} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px" }}>
                  <span class="text-[9px] mono" style={{ color: C.textMuted }}>7 sessions</span>
                  <span class="text-[9px] mono" style={{ color: selectedDetail.node.color }}>
                    {(selectedDetail.node.reward[selectedDetail.node.reward.length - 1] * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div class="text-[9px] uppercase tracking-widest font-medium mb-2" style={{ color: C.textDim }}>
                Last Action
              </div>
              <div class="text-xs" style={{ color: C.text, opacity: 0.8 }}>
                {selectedDetail.node.lastAction}
              </div>
              <div class="text-[9px] mono mt-1" style={{ color: C.textMuted }}>
                {selectedDetail.node.lastTs ? timeAgo(selectedDetail.node.lastTs) : "--"}
              </div>
            </div>

            <div>
              <div class="text-[9px] uppercase tracking-widest font-medium mb-2" style={{ color: C.textDim }}>
                Connections ({selectedDetail.edges.length})
              </div>
              <div class="space-y-1.5">
                {selectedDetail.edges.map((edge) => {
                  const isOutgoing = edge.source === selectedDetail.node.id
                  const otherNode = stateRef.current.nodes.find(
                    (n) => n.id === (isOutgoing ? edge.target : edge.source)
                  )
                  return (
                    <div key={edge.id} class="flex items-center gap-2 text-xs">
                      <svg width="12" height="8" viewBox="0 0 12 8" class="shrink-0">
                        {isOutgoing ? (
                          <path d="M0 4h8M6 1l3 3-3 3" fill="none" stroke={edge.color} stroke-width="1.5" />
                        ) : (
                          <path d="M12 4H4M6 1L3 4l3 3" fill="none" stroke={edge.color} stroke-width="1.5" />
                        )}
                      </svg>
                      <span class="mono text-[9px]" style={{ color: edge.color }}>
                        {edge.eventType}
                      </span>
                      <span class="text-[9px] ml-auto truncate" style={{ color: C.textDim }}>
                        {isOutgoing ? "to" : "from"} {otherNode?.label || "?"}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {selectedDetail.recentEvents.length > 0 && (
              <div>
                <div class="text-[9px] uppercase tracking-widest font-medium mb-2" style={{ color: C.textDim }}>
                  Recent Activity
                </div>
                <div class="space-y-1">
                  {selectedDetail.recentEvents.map((evt, i) => (
                    <div key={i} class="flex items-center justify-between text-[9px]">
                      <span class="mono" style={{ color: C.info }}>{evt.type}</span>
                      <span class="mono" style={{ color: C.textMuted }}>{timeAgo(evt.ts)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div class="p-4" style={{ borderTop: "1px solid rgba(60, 60, 60, 0.15)" }}>
            <div class="text-[8px] mono tracking-wider" style={{ color: C.textDim, opacity: 0.5 }}>
              Canvas 2D + WebGL Bloom / 4-pass Gaussian
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

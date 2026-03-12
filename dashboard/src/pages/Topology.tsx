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
  type: "agent" | "orchestrator" | "eval" | "service" | "gtm"
  status: "running" | "idle" | "stopped"
  eventCount: number
  lastAction: string
  lastTs: string
  x: number
  y: number
  targetX: number
  targetY: number
  radius: number
  baseRadius: number
  color: string
  glowColor: string
  pulsePhase: number
  reward: number[]
  produces?: string[]
  consumes?: string[]
  parentGtm?: string
  isGtm?: boolean
  childCount?: number
  aggregateReward?: number[]
}

interface ZoomPanState {
  scale: number
  offsetX: number
  offsetY: number
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
  recentEvents: { type: string; ts: string; data: string; source?: string }[]
  connectedServices: { id: string; label: string; direction: "in" | "out"; eventType: string }[]
}

function nodeColor(type: string): { fill: string; glow: string } {
  switch (type) {
    case "gtm": return { fill: C.cyan, glow: C.cyan + "88" }
    case "orchestrator": return { fill: C.purple, glow: C.purpleGlow }
    case "eval": return { fill: C.warning, glow: C.warningGlow }
    case "service": return { fill: C.success, glow: C.successGlow }
    default: return { fill: C.info, glow: C.infoGlow }
  }
}

// Label truncation for long service names
function truncateLabel(label: string, maxLen: number = 18): string {
  if (label.length <= maxLen) return label
  return label.slice(0, maxLen - 1) + "…"
}

// System agents that should be in the center cluster
const SYSTEM_AGENTS = new Set(["peter-parker", "telemetry-agent", "eval-engine", "stratus"])

const COLLAPSED_GTM_RADIUS = 55
const EXPANDED_GTM_RADIUS = 38

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
    const baseRadius = d.type === "orchestrator" ? 32 : d.type === "service" ? 28 : 24
    return {
      ...d,
      x: 0, y: 0, targetX: 0, targetY: 0,
      radius: baseRadius,
      baseRadius,
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

  // Build a set of GTM ids from nodes that end with -gtm or have type 'gtm'
  const gtmIds = new Set<string>()
  for (const n of apiNodes) {
    if (n.type === "gtm" || n.id.endsWith("-gtm")) {
      gtmIds.add(n.id)
    }
  }

  const nodes: TopoNode[] = apiNodes.map((n) => {
    // Determine if this is a GTM node
    const isGtm = n.type === "gtm" || n.id.endsWith("-gtm")

    // Determine parent GTM from node ID pattern: 'gtm-name/service-name'
    let parentGtm: string | undefined
    if (!isGtm && !SYSTEM_AGENTS.has(n.id)) {
      // Check if ID contains a slash (gtm/service pattern)
      if (n.id.includes("/")) {
        parentGtm = n.id.split("/")[0]
      } else {
        // Try to match by prefix (e.g., 'productrank-arena' -> 'productrank-gtm')
        for (const gtmId of gtmIds) {
          const prefix = gtmId.replace(/-gtm$/, "")
          if (n.id.startsWith(prefix + "-") || n.id.startsWith(prefix + "/")) {
            parentGtm = gtmId
            break
          }
        }
      }
    }

    const effectiveType = isGtm ? "gtm" : n.type
    let baseRadius: number
    if (isGtm) {
      baseRadius = EXPANDED_GTM_RADIUS
    } else if (SYSTEM_AGENTS.has(n.id)) {
      baseRadius = 28
    } else if (n.type === "orchestrator") {
      baseRadius = 26
    } else {
      baseRadius = 22
    }

    const c = nodeColor(effectiveType)
    return {
      id: n.id,
      label: n.label,
      type: effectiveType as TopoNode["type"],
      status: n.status,
      eventCount: n.eventCount || Math.floor(Math.random() * 200) + 50,
      lastAction: `${n.type} activity`,
      lastTs: new Date(now - Math.random() * 300000).toISOString(),
      reward: Array.from({ length: 7 }, () => 0.3 + Math.random() * 0.5),
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      radius: baseRadius,
      baseRadius,
      color: c.fill,
      glowColor: c.glow,
      pulsePhase: Math.random() * Math.PI * 2,
      produces: n.produces,
      consumes: n.consumes,
      parentGtm,
      isGtm,
      childCount: 0,
      aggregateReward: Array.from({ length: 7 }, () => 0.3 + Math.random() * 0.5),
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

// Cluster positions for GTMs (relative to center, will be scaled)
interface ClusterLayout {
  gtmX: number
  gtmY: number
  orbitRadius: number
}

function layoutNodes(
  nodes: TopoNode[],
  w: number,
  h: number,
  edges?: TopoEdge[],
  expandedGtms?: Set<string>,
) {
  const cx = w / 2
  const cy = h / 2
  const n = nodes.length

  if (n === 0) return

  const scale = Math.min(w / 1200, h / 800, 1)
  const expanded = expandedGtms || new Set<string>()

  const gtmNodes = nodes.filter(node => node.isGtm)
  const systemAgents = nodes.filter(node => SYSTEM_AGENTS.has(node.id))
  const serviceNodes = nodes.filter(node => !node.isGtm && !SYSTEM_AGENTS.has(node.id))

  const clusters: Map<string, TopoNode[]> = new Map()
  for (const gtm of gtmNodes) {
    clusters.set(gtm.id, [])
  }
  for (const svc of serviceNodes) {
    if (svc.parentGtm && clusters.has(svc.parentGtm)) {
      clusters.get(svc.parentGtm)!.push(svc)
    }
  }

  for (const gtm of gtmNodes) {
    const children = clusters.get(gtm.id) || []
    gtm.childCount = children.length
    if (children.length > 0) {
      gtm.aggregateReward = children[0].reward.map((_, i) => {
        const sum = children.reduce((acc, c) => acc + (c.reward[i] || 0), 0)
        return sum / children.length
      })
    }
    const isExpanded = expanded.has(gtm.id)
    gtm.radius = isExpanded ? gtm.baseRadius : COLLAPSED_GTM_RADIUS
  }

  const orphanServices = serviceNodes.filter(svc => !svc.parentGtm || !clusters.has(svc.parentGtm))

  const expandedGtmList = gtmNodes.filter(g => expanded.has(g.id))
  const collapsedGtmList = gtmNodes.filter(g => !expanded.has(g.id))

  const baseOrbitRadius = 160

  if (expandedGtmList.length === 1) {
    const expandedGtm = expandedGtmList[0]
    expandedGtm.targetX = cx
    expandedGtm.targetY = cy
    if (expandedGtm.x === 0 && expandedGtm.y === 0) {
      expandedGtm.x = cx + (Math.random() - 0.5) * 40
      expandedGtm.y = cy + (Math.random() - 0.5) * 40
    }

    const children = clusters.get(expandedGtm.id) || []
    const childCount = children.length
    if (childCount > 0) {
      const angleStep = (Math.PI * 2) / childCount
      const startAngle = -Math.PI / 2
      children.forEach((child, ci) => {
        const angle = startAngle + ci * angleStep
        const orbitR = baseOrbitRadius * scale + (ci % 2 === 0 ? 15 : -10)
        child.targetX = cx + Math.cos(angle) * orbitR
        child.targetY = cy + Math.sin(angle) * orbitR
        if (child.x === 0 && child.y === 0) {
          child.x = child.targetX + (Math.random() - 0.5) * 30
          child.y = child.targetY + (Math.random() - 0.5) * 30
        }
      })
    }

    const edgeSpread = Math.min(w, h) * 0.42
    collapsedGtmList.forEach((gtm, i) => {
      const angle = (Math.PI * 2 * i) / Math.max(collapsedGtmList.length, 1) - Math.PI / 2
      gtm.targetX = cx + Math.cos(angle) * edgeSpread
      gtm.targetY = cy + Math.sin(angle) * edgeSpread
      if (gtm.x === 0 && gtm.y === 0) {
        gtm.x = gtm.targetX + (Math.random() - 0.5) * 40
        gtm.y = gtm.targetY + (Math.random() - 0.5) * 40
      }
      const children = clusters.get(gtm.id) || []
      for (const child of children) {
        child.targetX = gtm.targetX
        child.targetY = gtm.targetY
        if (child.x === 0 && child.y === 0) {
          child.x = child.targetX
          child.y = child.targetY
        }
      }
    })
  } else {
    const gtmSpacing = 180 * scale
    const totalWidth = (gtmNodes.length - 1) * gtmSpacing
    const startX = cx - totalWidth / 2

    gtmNodes.forEach((gtm, i) => {
      const isExp = expanded.has(gtm.id)
      gtm.targetX = startX + i * gtmSpacing
      gtm.targetY = cy
      if (gtm.x === 0 && gtm.y === 0) {
        gtm.x = gtm.targetX + (Math.random() - 0.5) * 40
        gtm.y = gtm.targetY + (Math.random() - 0.5) * 40
      }

      const children = clusters.get(gtm.id) || []
      if (isExp && children.length > 0) {
        const childCount = children.length
        const angleStep = (Math.PI * 2) / childCount
        const startAngle = -Math.PI / 2
        children.forEach((child, ci) => {
          const angle = startAngle + ci * angleStep
          const orbitR = baseOrbitRadius * scale + (ci % 2 === 0 ? 15 : -10)
          child.targetX = gtm.targetX + Math.cos(angle) * orbitR
          child.targetY = gtm.targetY + Math.sin(angle) * orbitR
          if (child.x === 0 && child.y === 0) {
            child.x = child.targetX + (Math.random() - 0.5) * 30
            child.y = child.targetY + (Math.random() - 0.5) * 30
          }
        })
      } else {
        for (const child of children) {
          child.targetX = gtm.targetX
          child.targetY = gtm.targetY
          if (child.x === 0 && child.y === 0) {
            child.x = child.targetX
            child.y = child.targetY
          }
        }
      }
    })
  }

  const systemCount = systemAgents.length
  if (systemCount > 0) {
    const systemY = 80
    const diamondRadius = 42 * scale
    const systemPositions = [
      { x: cx, y: systemY },
      { x: cx + diamondRadius, y: systemY + diamondRadius * 0.7 },
      { x: cx, y: systemY + diamondRadius * 1.4 },
      { x: cx - diamondRadius, y: systemY + diamondRadius * 0.7 },
    ]

    const agentPositionMap: Record<string, number> = {
      "peter-parker": 0,
      "stratus": 1,
      "eval-engine": 2,
      "telemetry-agent": 3,
    }

    systemAgents.forEach((agent, i) => {
      const posIdx = agentPositionMap[agent.id] ?? (i % 4)
      const pos = systemPositions[posIdx]
      agent.targetX = pos.x
      agent.targetY = pos.y
      if (agent.x === 0 && agent.y === 0) {
        agent.x = pos.x + (Math.random() - 0.5) * 20
        agent.y = pos.y + (Math.random() - 0.5) * 20
      }
    })
  }

  if (orphanServices.length > 0) {
    const outerRadius = Math.min(w, h) * 0.44
    const angleStep = (Math.PI * 2) / orphanServices.length
    const startAngle = Math.PI / 6
    orphanServices.forEach((svc, i) => {
      const angle = startAngle + i * angleStep
      svc.targetX = cx + Math.cos(angle) * outerRadius
      svc.targetY = cy + Math.sin(angle) * outerRadius
      if (svc.x === 0 && svc.y === 0) {
        svc.x = svc.targetX + (Math.random() - 0.5) * 50
        svc.y = svc.targetY + (Math.random() - 0.5) * 50
      }
    })
  }

  const visibleNodes = nodes.filter(node => {
    if (node.isGtm || SYSTEM_AGENTS.has(node.id) || !node.parentGtm) return true
    return expanded.has(node.parentGtm)
  })

  for (let iter = 0; iter < 6; iter++) {
    for (let i = 0; i < visibleNodes.length; i++) {
      for (let j = i + 1; j < visibleNodes.length; j++) {
        const ni = visibleNodes[i]
        const nj = visibleNodes[j]

        if (ni.isGtm && nj.parentGtm === ni.id && expanded.has(ni.id)) continue
        if (nj.isGtm && ni.parentGtm === nj.id && expanded.has(nj.id)) continue

        const dx = ni.targetX - nj.targetX
        const dy = ni.targetY - nj.targetY
        const dist = Math.sqrt(dx * dx + dy * dy)
        const minDist = (ni.radius + nj.radius) * 2.5

        if (dist < minDist && dist > 0) {
          const force = (minDist - dist) * 0.2
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force

          const niLocked = ni.isGtm || SYSTEM_AGENTS.has(ni.id)
          const njLocked = nj.isGtm || SYSTEM_AGENTS.has(nj.id)

          if (!niLocked) {
            ni.targetX += fx * (njLocked ? 1.0 : 0.5)
            ni.targetY += fy * (njLocked ? 1.0 : 0.5)
          }
          if (!njLocked) {
            nj.targetX -= fx * (niLocked ? 1.0 : 0.5)
            nj.targetY -= fy * (niLocked ? 1.0 : 0.5)
          }
        }
      }
    }
  }

  const padding = 60
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
  zoomPan?: ZoomPanState,
  expandedGtms?: Set<string>,
) {
  ctx.clearRect(0, 0, w, h)

  const zoom = zoomPan || { scale: 1, offsetX: 0, offsetY: 0 }
  const expanded = expandedGtms || new Set<string>()

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

  ctx.save()
  ctx.translate(zoom.offsetX, zoom.offsetY)
  ctx.scale(zoom.scale, zoom.scale)

  const visibleNodes = nodes.filter(node => {
    if (node.isGtm || SYSTEM_AGENTS.has(node.id) || !node.parentGtm) return true
    return expanded.has(node.parentGtm)
  })

  const gtmNodes = nodes.filter(n => n.isGtm)
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  for (const gtm of gtmNodes) {
    const isExp = expanded.has(gtm.id)
    if (!isExp) continue

    const children = nodes.filter(n => n.parentGtm === gtm.id)
    if (children.length === 0) continue

    let maxDist = 0
    for (const child of children) {
      const dx = child.x - gtm.x
      const dy = child.y - gtm.y
      const dist = Math.sqrt(dx * dx + dy * dy) + child.radius + 20
      maxDist = Math.max(maxDist, dist)
    }

    const clusterRadius = Math.max(maxDist, 80)
    ctx.save()
    ctx.globalAlpha = 0.08
    ctx.strokeStyle = gtm.color
    ctx.lineWidth = 1
    ctx.setLineDash([8, 12])
    ctx.beginPath()
    ctx.arc(gtm.x, gtm.y, clusterRadius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])

    const grad = ctx.createRadialGradient(gtm.x, gtm.y, 0, gtm.x, gtm.y, clusterRadius)
    grad.addColorStop(0, hexToRGBA(gtm.color, 0.03))
    grad.addColorStop(0.7, hexToRGBA(gtm.color, 0.015))
    grad.addColorStop(1, hexToRGBA(gtm.color, 0))
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(gtm.x, gtm.y, clusterRadius, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // Draw center system cluster boundary
  const systemAgents = nodes.filter(n => SYSTEM_AGENTS.has(n.id))
  if (systemAgents.length > 1) {
    // Find center and max extent of system agents
    let sumX = 0, sumY = 0
    for (const agent of systemAgents) {
      sumX += agent.x
      sumY += agent.y
    }
    const centerX = sumX / systemAgents.length
    const centerY = sumY / systemAgents.length

    let maxDist = 0
    for (const agent of systemAgents) {
      const dx = agent.x - centerX
      const dy = agent.y - centerY
      const dist = Math.sqrt(dx * dx + dy * dy) + agent.radius + 15
      maxDist = Math.max(maxDist, dist)
    }

    // Draw subtle diamond/circle for system cluster
    ctx.save()
    ctx.globalAlpha = 0.06
    ctx.strokeStyle = C.purple
    ctx.lineWidth = 1
    ctx.setLineDash([4, 8])
    ctx.beginPath()
    ctx.arc(centerX, centerY, maxDist, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
  }

  const drawnAggregateEdges = new Set<string>()

  for (const edge of edges) {
    let src = nodeMap.get(edge.source)
    let tgt = nodeMap.get(edge.target)
    if (!src || !tgt) continue

    const srcCollapsed = src.parentGtm && !expanded.has(src.parentGtm)
    const tgtCollapsed = tgt.parentGtm && !expanded.has(tgt.parentGtm)

    if (srcCollapsed) {
      const parentGtm = nodeMap.get(src.parentGtm!)
      if (parentGtm) src = parentGtm
    }
    if (tgtCollapsed) {
      const parentGtm = nodeMap.get(tgt.parentGtm!)
      if (parentGtm) tgt = parentGtm
    }

    if (src.id === tgt.id) continue

    const aggregateKey = `${src.id}->${tgt.id}`
    const isAggregate = srcCollapsed || tgtCollapsed
    if (isAggregate) {
      if (drawnAggregateEdges.has(aggregateKey)) continue
      drawnAggregateEdges.add(aggregateKey)
    }

    const highlighted = connectedEdges.has(edge.id) ||
      (srcCollapsed && edge.source && nodeMap.get(edge.source)?.parentGtm === src.id) ||
      (tgtCollapsed && edge.target && nodeMap.get(edge.target)?.parentGtm === tgt.id)
    const dimmed = connectedEdges.size > 0 && !highlighted

    const { sx, sy, c1x, c1y, c2x, c2y, ex, ey } = edgeCurve(src, tgt)
    const timeSince = Date.now() - edge.lastFired
    const recentFire = timeSince < 5000
    const fireIntensity = recentFire ? 1 - timeSince / 5000 : 0
    const baseAlpha = edge.active ? (highlighted ? 0.8 : 0.35) : 0.08
    const alpha = dimmed ? 0.05 : Math.min(1, baseAlpha + fireIntensity * 0.5)

    const lineWidthMult = isAggregate ? 1.8 : 1

    ctx.save()
    ctx.globalAlpha = alpha * 0.4
    ctx.strokeStyle = edge.color
    ctx.shadowColor = edge.color
    ctx.shadowBlur = highlighted ? 20 : recentFire ? 14 : 8
    ctx.lineWidth = (highlighted ? 5 : 3) * lineWidthMult
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey)
    ctx.stroke()
    ctx.restore()

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.strokeStyle = edge.color
    ctx.lineWidth = (highlighted ? 2.5 : 1.2) * lineWidthMult
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey)
    ctx.stroke()
    ctx.restore()

    const arrowT = 0.88
    const [ax, ay] = cubicBezier(sx, sy, c1x, c1y, c2x, c2y, ex, ey, arrowT)
    const [bx, by] = cubicBezier(sx, sy, c1x, c1y, c2x, c2y, ex, ey, arrowT + 0.04)
    const angle = Math.atan2(by - ay, bx - ax)
    const aSize = (highlighted ? 9 : 6) * lineWidthMult
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

  for (const node of visibleNodes) {
    const isHovered = hoveredId === node.id
    const isSelected = selectedId === node.id
    const dimmed = connectedNodes.size > 0 && !connectedNodes.has(node.id) && !isHovered && !isSelected
    const nodeAlpha = dimmed ? 0.15 : 1.0
    const isCollapsedGtm = node.isGtm && !expanded.has(node.id)

    const breathe = Math.sin(time * 0.002 + node.pulsePhase) * 0.15 + 0.85
    const r = node.radius * (isHovered ? 1.15 : isSelected ? 1.1 : 1.0)

    if (node.status === "running" || isHovered || isSelected) {
      const glowR = r * (isSelected ? 3.5 : isHovered ? 3.0 : isCollapsedGtm ? 2.8 : 2.2) * breathe
      const grad = ctx.createRadialGradient(node.x, node.y, r * 0.5, node.x, node.y, glowR)
      grad.addColorStop(0, hexToRGBA(node.color, 0.25 * nodeAlpha))
      grad.addColorStop(0.5, hexToRGBA(node.color, 0.08 * nodeAlpha))
      grad.addColorStop(1, hexToRGBA(node.color, 0))
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2)
      ctx.fill()
    }

    if (node.isGtm) {
      const haloR = r * (isCollapsedGtm ? 1.3 : 1.6)
      const haloAlpha = (Math.sin(time * 0.002 + node.pulsePhase) * 0.2 + 0.4) * nodeAlpha

      ctx.save()
      ctx.globalAlpha = haloAlpha * 0.5
      ctx.strokeStyle = node.color
      ctx.lineWidth = isCollapsedGtm ? 3 : 2.5
      ctx.beginPath()
      ctx.arc(node.x, node.y, haloR, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()

      ctx.save()
      ctx.globalAlpha = haloAlpha * 0.3
      ctx.strokeStyle = node.color
      ctx.lineWidth = 1
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.arc(node.x, node.y, r * 1.15, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    } else if (node.status === "running") {
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
    ctx.shadowBlur = isSelected ? 25 : isHovered ? 18 : isCollapsedGtm ? 15 : 10
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

  ctx.restore()
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

  const [expandedGtms, setExpandedGtms] = useState<Set<string>>(new Set())
  const [zoomPan, setZoomPan] = useState<ZoomPanState>({ scale: 1, offsetX: 0, offsetY: 0 })
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 })

  const selectNode = useCallback((node: TopoNode | null) => {
    const st = stateRef.current
    if (!node || st.selectedNode === node.id) {
      st.selectedNode = null
      setSelectedDetail(null)
    } else {
      st.selectedNode = node.id
      const connEdges = st.edges.filter((e) => e.source === node.id || e.target === node.id)

      // Build connected services list
      const connectedServices: DetailPanel["connectedServices"] = []
      for (const edge of connEdges) {
        const isOutgoing = edge.source === node.id
        const otherId = isOutgoing ? edge.target : edge.source
        const otherNode = st.nodes.find((n) => n.id === otherId)
        if (otherNode) {
          connectedServices.push({
            id: otherId,
            label: otherNode.label,
            direction: isOutgoing ? "out" : "in",
            eventType: edge.eventType,
          })
        }
      }

      // Filter live events involving this node
      const nodeEvents = eventLog
        .filter((evt) => {
          const evtType = evt.type.toLowerCase()
          const nodeId = node.id.toLowerCase()
          // Match events that contain the node name or are from/to this node
          return evtType.includes(nodeId.split("-")[0]) ||
            connEdges.some((e) => evtType.startsWith(e.eventType.split(":")[0]))
        })
        .slice(0, 8)
        .map((evt) => ({
          type: evt.type,
          ts: evt.ts,
          data: "",
          source: undefined,
        }))

      // Fallback to edge-based events if no live events
      const recentEvents = nodeEvents.length > 0
        ? nodeEvents
        : connEdges.slice(0, 5).map((e) => ({
            type: e.eventType,
            ts: new Date(e.lastFired).toISOString(),
            data: `${e.source} -> ${e.target}`,
            source: e.source,
          }))

      setSelectedDetail({
        node,
        edges: connEdges,
        recentEvents,
        connectedServices,
      })
    }
  }, [eventLog])

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

    const screenToWorld = (sx: number, sy: number) => {
      const { scale, offsetX, offsetY } = zoomPan
      return {
        x: (sx - offsetX) / scale,
        y: (sy - offsetY) / scale,
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      const rect = glCanvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      st.mouse = { x: sx, y: sy }

      if (isPanningRef.current) {
        const dx = sx - panStartRef.current.x
        const dy = sy - panStartRef.current.y
        setZoomPan((prev) => ({
          ...prev,
          offsetX: panStartRef.current.offsetX + dx,
          offsetY: panStartRef.current.offsetY + dy,
        }))
        return
      }

      const { x: mx, y: my } = screenToWorld(sx, sy)

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

      const visibleNodes = st.nodes.filter((n) => {
        if (n.isGtm || SYSTEM_AGENTS.has(n.id) || !n.parentGtm) return true
        return expandedGtms.has(n.parentGtm)
      })

      let closest: TopoNode | null = null
      let closestDist = Infinity
      for (const n of visibleNodes) {
        const d = distToNode(n.x, n.y, mx, my, n.radius * 1.5)
        if (d < closestDist && d < 20 / zoomPan.scale) {
          closestDist = d
          closest = n
        }
      }
      st.hoveredNode = closest?.id || null
      glCanvas.style.cursor = closest ? "pointer" : isPanningRef.current ? "grabbing" : "default"
    }

    const handleMouseDown = (e: MouseEvent) => {
      const rect = glCanvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const { x: mx, y: my } = screenToWorld(sx, sy)

      const visibleNodes = st.nodes.filter((n) => {
        if (n.isGtm || SYSTEM_AGENTS.has(n.id) || !n.parentGtm) return true
        return expandedGtms.has(n.parentGtm)
      })

      let hit: TopoNode | null = null
      for (const n of visibleNodes) {
        if (distToNode(n.x, n.y, mx, my, n.radius * 1.5) < 5 / zoomPan.scale) {
          hit = n
          break
        }
      }
      if (hit) {
        st.dragging = hit.id
        st.dragOffset = { x: mx - hit.x, y: my - hit.y }
      } else {
        isPanningRef.current = true
        panStartRef.current = { x: sx, y: sy, offsetX: zoomPan.offsetX, offsetY: zoomPan.offsetY }
        glCanvas.style.cursor = "grabbing"
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      const wasDragging = st.dragging
      const wasPanning = isPanningRef.current
      const rect = glCanvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const { x: mx, y: my } = screenToWorld(sx, sy)

      if (wasPanning) {
        const panDist = Math.sqrt(
          (sx - panStartRef.current.x) ** 2 + (sy - panStartRef.current.y) ** 2
        )
        isPanningRef.current = false
        glCanvas.style.cursor = "default"
        if (panDist < 5) {
          st.selectedNode = null
          setSelectedDetail(null)
        }
        return
      }

      if (wasDragging) {
        const node = st.nodes.find((n) => n.id === wasDragging)
        st.dragging = null
        if (node) {
          const movedDist = Math.sqrt(
            (mx - (st.dragOffset.x + node.targetX)) ** 2 +
            (my - (st.dragOffset.y + node.targetY)) ** 2
          )
          if (movedDist < 5 / zoomPan.scale) {
            if (node.isGtm) {
              setExpandedGtms((prev) => {
                const next = new Set(prev)
                if (next.has(node.id)) {
                  next.delete(node.id)
                } else {
                  next.add(node.id)
                }
                return next
              })
              const rect2 = container.getBoundingClientRect()
              setTimeout(() => {
                layoutNodes(st.nodes, rect2.width, rect2.height, st.edges, expandedGtms.has(node.id) ? new Set([...expandedGtms].filter(id => id !== node.id)) : new Set([...expandedGtms, node.id]))
                forceRender((n) => n + 1)
              }, 10)
            } else {
              selectNode(node)
            }
          }
        }
        return
      }

      const visibleNodes = st.nodes.filter((n) => {
        if (n.isGtm || SYSTEM_AGENTS.has(n.id) || !n.parentGtm) return true
        return expandedGtms.has(n.parentGtm)
      })

      let hit: TopoNode | null = null
      for (const n of visibleNodes) {
        if (distToNode(n.x, n.y, mx, my, n.radius * 1.5) < 5 / zoomPan.scale) {
          hit = n
          break
        }
      }
      if (hit) {
        if (hit.isGtm) {
          setExpandedGtms((prev) => {
            const next = new Set(prev)
            if (next.has(hit!.id)) {
              next.delete(hit!.id)
            } else {
              next.add(hit!.id)
            }
            return next
          })
          const rect2 = container.getBoundingClientRect()
          setTimeout(() => {
            layoutNodes(st.nodes, rect2.width, rect2.height, st.edges, expandedGtms.has(hit!.id) ? new Set([...expandedGtms].filter(id => id !== hit!.id)) : new Set([...expandedGtms, hit!.id]))
            forceRender((n) => n + 1)
          }, 10)
        } else {
          selectNode(hit)
        }
      } else {
        st.selectedNode = null
        setSelectedDetail(null)
      }
    }

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = glCanvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top

      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9
      const newScale = Math.max(0.3, Math.min(3, zoomPan.scale * zoomFactor))

      const wx = (sx - zoomPan.offsetX) / zoomPan.scale
      const wy = (sy - zoomPan.offsetY) / zoomPan.scale

      setZoomPan({
        scale: newScale,
        offsetX: sx - wx * newScale,
        offsetY: sy - wy * newScale,
      })
    }

    const handleDblClick = (e: MouseEvent) => {
      e.preventDefault()
      setZoomPan({ scale: 1, offsetX: 0, offsetY: 0 })
    }

    glCanvas.addEventListener("mousemove", handleMouseMove)
    glCanvas.addEventListener("mousedown", handleMouseDown)
    glCanvas.addEventListener("mouseup", handleMouseUp)
    glCanvas.addEventListener("wheel", handleWheel, { passive: false })
    glCanvas.addEventListener("dblclick", handleDblClick)

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
        drawScene(ctx2d, cw, ch, st.nodes, st.edges, st.hoveredNode, st.selectedNode, now, zoomPan, expandedGtms)
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
      glCanvas.removeEventListener("wheel", handleWheel)
      glCanvas.removeEventListener("dblclick", handleDblClick)
      cancelAnimationFrame(animRef.current)
      unsub?.()
    }
  }, [selectNode, zoomPan, expandedGtms])

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

        {/* GTM Cluster Labels */}
        {st.nodes.length > 0 && (
          <div class="absolute inset-0 pointer-events-none" style={{ zIndex: 1.5 }}>
            {st.nodes.filter(n => n.isGtm).map((gtm) => {
              // Find max extent of this cluster to position label above
              const children = st.nodes.filter(n => n.parentGtm === gtm.id)
              let minY = gtm.y
              for (const child of children) {
                minY = Math.min(minY, child.y - child.radius)
              }
              // Position label above the cluster
              const labelY = minY - 45

              return (
                <div
                  key={`cluster-${gtm.id}`}
                  class="absolute"
                  style={{
                    left: `${gtm.x}px`,
                    top: `${Math.max(20, labelY)}px`,
                    transform: "translateX(-50%)",
                  }}
                >
                  <span style={{
                    fontSize: "9px",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 600,
                    padding: "3px 10px",
                    borderRadius: "12px",
                    color: gtm.color,
                    background: "rgba(15, 15, 18, 0.7)",
                    border: `1px solid ${gtm.color}30`,
                    textTransform: "uppercase",
                    letterSpacing: "1.5px",
                  }}>
                    {gtm.label.replace(/-gtm$/i, "").toUpperCase()}
                  </span>
                </div>
              )
            })}

            {/* System Cluster Label */}
            {st.nodes.filter(n => SYSTEM_AGENTS.has(n.id)).length > 1 && (() => {
              const systemAgents = st.nodes.filter(n => SYSTEM_AGENTS.has(n.id))
              let sumX = 0, minY = Infinity
              for (const agent of systemAgents) {
                sumX += agent.x
                minY = Math.min(minY, agent.y - agent.radius)
              }
              const centerX = sumX / systemAgents.length
              const labelY = minY - 35

              return (
                <div
                  class="absolute"
                  style={{
                    left: `${centerX}px`,
                    top: `${Math.max(20, labelY)}px`,
                    transform: "translateX(-50%)",
                  }}
                >
                  <span style={{
                    fontSize: "8px",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 500,
                    padding: "2px 8px",
                    borderRadius: "10px",
                    color: C.purple,
                    background: "rgba(15, 15, 18, 0.6)",
                    border: `1px solid ${C.purple}25`,
                    textTransform: "uppercase",
                    letterSpacing: "1px",
                  }}>
                    SYSTEM
                  </span>
                </div>
              )
            })()}
          </div>
        )}

        {st.nodes.length > 0 && (
          <div
            class="absolute inset-0 pointer-events-none"
            style={{
              zIndex: 2,
              transform: `translate(${zoomPan.offsetX}px, ${zoomPan.offsetY}px) scale(${zoomPan.scale})`,
              transformOrigin: "0 0",
            }}
          >
            {st.nodes.filter((node) => {
              if (node.isGtm || SYSTEM_AGENTS.has(node.id) || !node.parentGtm) return true
              return expandedGtms.has(node.parentGtm)
            }).map((node) => {
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
              const isCollapsedGtm = node.isGtm && !expandedGtms.has(node.id)

              return (
                <div
                  key={node.id}
                  class="absolute pointer-events-auto"
                  style={{
                    left: `${node.x}px`,
                    top: `${node.y + node.radius + 14}px`,
                    transform: `translateX(-50%) scale(${1 / zoomPan.scale})`,
                    transformOrigin: "center top",
                    transition: "opacity 0.3s ease",
                    opacity: dimmed ? 0.15 : isHovered || isSelected ? 1 : 0.8,
                    cursor: node.isGtm ? "pointer" : "default",
                  }}
                >
                  <div style={{
                    background: isSelected ? "rgba(18, 18, 22, 0.92)" : "rgba(18, 18, 22, 0.75)",
                    backdropFilter: "blur(16px)",
                    WebkitBackdropFilter: "blur(16px)",
                    border: `1px solid ${isSelected ? node.color + "55" : isHovered ? node.color + "33" : "rgba(255,255,255,0.06)"}`,
                    borderRadius: "10px",
                    padding: isCollapsedGtm ? "10px 14px" : "8px 12px",
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
                      <span style={{ fontSize: isCollapsedGtm ? "13px" : node.isGtm ? "12px" : "11px", fontWeight: node.isGtm ? 700 : 600, color: C.text }}>
                        {truncateLabel(node.label, node.isGtm ? 20 : 16)}
                      </span>
                      {isCollapsedGtm && node.childCount ? (
                        <span style={{
                          fontSize: "9px",
                          fontFamily: "'JetBrains Mono', monospace",
                          padding: "2px 6px",
                          borderRadius: "6px",
                          backgroundColor: `${node.color}20`,
                          color: node.color,
                        }}>
                          {node.childCount} services
                        </span>
                      ) : (
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
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "5px", gap: "8px" }}>
                      <span style={{ fontSize: "9px", fontFamily: "'JetBrains Mono', monospace", color: C.textMuted }}>
                        {node.eventCount} events
                      </span>
                      <Sparkline data={isCollapsedGtm && node.aggregateReward ? node.aggregateReward : node.reward} color={node.color} width={isCollapsedGtm ? 60 : 48} height={14} />
                    </div>
                    {isCollapsedGtm && (
                      <div style={{ marginTop: "6px", fontSize: "8px", color: C.textDim, textAlign: "center" }}>
                        click to expand
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {st.edges.length > 0 && (
          <div
            class="absolute inset-0 pointer-events-none"
            style={{
              zIndex: 3,
              transform: `translate(${zoomPan.offsetX}px, ${zoomPan.offsetY}px) scale(${zoomPan.scale})`,
              transformOrigin: "0 0",
            }}
          >
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
                    transform: `translate(-50%, -50%) scale(${1 / zoomPan.scale})`,
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

        <div class="absolute bottom-5 left-5 flex items-center gap-4" style={{ zIndex: 10 }}>
          {[
            { color: C.cyan, label: "GTM", isGtm: true },
            { color: C.info, label: "Agent" },
            { color: C.purple, label: "Orchestrator" },
            { color: C.warning, label: "Eval" },
            { color: C.success, label: "Service" },
          ].map((item) => (
            <div key={item.label} class="flex items-center gap-1.5">
              <span style={{
                width: item.isGtm ? "10px" : "6px",
                height: item.isGtm ? "10px" : "6px",
                borderRadius: "50%",
                backgroundColor: item.color,
                boxShadow: `0 0 6px ${item.color}88`,
                border: item.isGtm ? `1.5px solid ${item.color}` : "none",
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

            <div class="flex items-center gap-2 flex-wrap">
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

            {/* Produces/Consumes Scope Badges */}
            {(selectedDetail.node.produces?.length || selectedDetail.node.consumes?.length) && (
              <div class="mt-3 space-y-2">
                {selectedDetail.node.produces && selectedDetail.node.produces.length > 0 && (
                  <div>
                    <span class="text-[8px] uppercase tracking-widest" style={{ color: C.textDim }}>produces</span>
                    <div class="flex flex-wrap gap-1 mt-1">
                      {selectedDetail.node.produces.map((scope) => (
                        <span
                          key={scope}
                          class="text-[8px] mono px-1.5 py-0.5 rounded"
                          style={{
                            background: `${C.success}15`,
                            color: C.success,
                            border: `1px solid ${C.success}25`,
                          }}
                        >
                          {scope}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {selectedDetail.node.consumes && selectedDetail.node.consumes.length > 0 && (
                  <div>
                    <span class="text-[8px] uppercase tracking-widest" style={{ color: C.textDim }}>consumes</span>
                    <div class="flex flex-wrap gap-1 mt-1">
                      {selectedDetail.node.consumes.map((scope) => (
                        <span
                          key={scope}
                          class="text-[8px] mono px-1.5 py-0.5 rounded"
                          style={{
                            background: `${C.info}15`,
                            color: C.info,
                            border: `1px solid ${C.info}25`,
                          }}
                        >
                          {scope}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
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

            {/* Connected Services - grouped by direction */}
            <div>
              <div class="text-[9px] uppercase tracking-widest font-medium mb-2" style={{ color: C.textDim }}>
                Connected Services ({selectedDetail.connectedServices.length})
              </div>
              <div class="space-y-3">
                {/* Services that feed INTO this node */}
                {selectedDetail.connectedServices.filter(s => s.direction === "in").length > 0 && (
                  <div>
                    <div class="text-[8px] uppercase tracking-wider mb-1.5 flex items-center gap-1.5" style={{ color: C.info }}>
                      <svg width="10" height="6" viewBox="0 0 10 6">
                        <path d="M10 3H2M4 0.5L1 3l3 2.5" fill="none" stroke={C.info} stroke-width="1.2" />
                      </svg>
                      feeds into
                    </div>
                    <div class="space-y-1">
                      {selectedDetail.connectedServices.filter(s => s.direction === "in").map((svc) => (
                        <div key={svc.id} class="flex items-center gap-2 text-xs pl-3">
                          <span style={{ color: C.text }}>{svc.label}</span>
                          <span class="mono text-[8px] ml-auto" style={{ color: C.textDim }}>{svc.eventType}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Services this node feeds OUT to */}
                {selectedDetail.connectedServices.filter(s => s.direction === "out").length > 0 && (
                  <div>
                    <div class="text-[8px] uppercase tracking-wider mb-1.5 flex items-center gap-1.5" style={{ color: C.success }}>
                      <svg width="10" height="6" viewBox="0 0 10 6">
                        <path d="M0 3h8M6 0.5l3 2.5-3 2.5" fill="none" stroke={C.success} stroke-width="1.2" />
                      </svg>
                      feeds out to
                    </div>
                    <div class="space-y-1">
                      {selectedDetail.connectedServices.filter(s => s.direction === "out").map((svc) => (
                        <div key={svc.id} class="flex items-center gap-2 text-xs pl-3">
                          <span style={{ color: C.text }}>{svc.label}</span>
                          <span class="mono text-[8px] ml-auto" style={{ color: C.textDim }}>{svc.eventType}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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

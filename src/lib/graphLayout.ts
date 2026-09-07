/**
 * Deterministic vault-graph layout — ported verbatim from the first HUD
 * (~/pharos/hud/layout.js). Every coordinate derives from the note's stable
 * path, so a note stays where it was between reloads; domains cluster at
 * hashed poles. Adding or reordering notes cannot move an existing one.
 */

export type GraphNode = { t: string; d: string; n: number; p: string };

export type Graph = {
  nodes: GraphNode[];
  edges: [number, number][];
  shown?: number;
  total_notes?: number;
  total_links?: number;
  building?: boolean;
};

export type LayoutPoint = {
  x: number; y: number; z: number;
  s: number; h: number;
  n: number; t: string; d: string;
  p: number;
};

export function hash32(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function random01(value: string, salt: string): number {
  return hash32(`${salt}\u0000${value}`) / 0x100000000;
}

function cross(a: number[], b: number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm(a: number[]): number[] {
  const m = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / m, a[1] / m, a[2] / m];
}

function domainPole(domain: string): { x: number; y: number; z: number } {
  const y = 1 - random01(domain, "domain-y") * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = random01(domain, "domain-theta") * Math.PI * 2;
  return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
}

export function layoutGraph(g: Graph): { pts: LayoutPoint[]; edges: [number, number][]; meta: Graph } {
  const maxDegree = Math.max(1, ...g.nodes.map((n) => n.n || 0));
  const poles = new Map<string, { x: number; y: number; z: number }>();
  const pts = g.nodes.map((n) => {
    const path = n.p || n.t || "";
    if (!poles.has(n.d)) poles.set(n.d, domainPole(n.d));
    const pole = poles.get(n.d)!;
    const up = Math.abs(pole.y) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const ex = norm(cross([pole.x, pole.y, pole.z], up));
    const ey = norm(cross([pole.x, pole.y, pole.z], ex));

    const spread = 0.82;
    const angle = spread * Math.sqrt(random01(path, "offset-radius"));
    const theta = random01(path, "offset-theta") * Math.PI * 2;
    const sa = Math.sin(angle), ca = Math.cos(angle);
    const dir = [
      pole.x * ca + (ex[0] * Math.cos(theta) + ey[0] * Math.sin(theta)) * sa,
      pole.y * ca + (ex[1] * Math.cos(theta) + ey[1] * Math.sin(theta)) * sa,
      pole.z * ca + (ex[2] * Math.cos(theta) + ey[2] * Math.sin(theta)) * sa,
    ];
    const radius = 0.66 + random01(path, "shell-radius") * 0.34;
    const weight = Math.log(1 + (n.n || 0)) / Math.log(1 + maxDegree);
    return {
      x: dir[0] * radius, y: dir[1] * radius, z: dir[2] * radius,
      s: 0.45 + weight * 1.9,
      h: random01(n.d, "domain-hue"),
      n: n.n, t: n.t, d: n.d,
      p: random01(path, "pulse-phase") * Math.PI * 2,
    };
  });
  return { pts, edges: g.edges || [], meta: g };
}

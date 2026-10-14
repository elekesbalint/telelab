// Shared track-map projection and outline stroke (breaks on large jumps).

export function mapFit(pts, w, h, pad = 28) {
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const sc = Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxZ - minZ || 1));
  const ox = (w - (maxX - minX) * sc) / 2, oy = (h - (maxZ - minZ) * sc) / 2;
  return (x, z) => [ox + (x - minX) * sc, h - (oy + (z - minZ) * sc)];
}

function medianSeg(outline) {
  const segs = [];
  for (let i = 1; i < outline.length; i++) {
    segs.push(Math.hypot(outline[i][0] - outline[i - 1][0], outline[i][1] - outline[i - 1][1]));
  }
  if (!segs.length) return 1;
  segs.sort((a, b) => a - b);
  return segs[Math.floor(segs.length / 2)] || 1;
}

/** Stroke a lap-ordered outline, lifting the pen across infield chords. */
export function strokeOutline(ctx, outline, P, { close = true } = {}) {
  if (outline.length < 2) return;
  const maxJump = medianSeg(outline) * 6;
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i < outline.length; i++) {
    const [a, b] = P(outline[i][0], outline[i][1]);
    if (!pen) { ctx.moveTo(a, b); pen = true; continue; }
    const d = Math.hypot(outline[i][0] - outline[i - 1][0], outline[i][1] - outline[i - 1][1]);
    if (d > maxJump) ctx.moveTo(a, b);
    else ctx.lineTo(a, b);
  }
  if (close && outline.length > 8) {
    const a = outline[0], z = outline.at(-1);
    if (Math.hypot(a[0] - z[0], a[1] - z[1]) <= maxJump * 1.5) ctx.closePath();
  }
  ctx.stroke();
}

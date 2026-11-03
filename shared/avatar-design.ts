export type AvatarEye = { cx: number; cy: number; rx: number; ry: number };
export type AvatarDesign = { bodyPath: string; color: string; eyes: [AvatarEye, AvatarEye] };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid avatar design.");
  return value as Record<string, unknown>;
}

function number(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error("Avatar coordinates are out of bounds.");
  }
  return value;
}

// A deliberately small SVG grammar: absolute coordinates and bounded Bezier controls.
// Curves stay within the control-point bounds. No XML, URLs, styles, or executable markup.
function parseBodyPath(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4000) throw new Error("Invalid avatar path.");
  const tokenPattern = /[MLHVCQZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  const tokens = value.match(tokenPattern);
  if (!tokens || tokens.length > 512 || value.replace(tokenPattern, "").replace(/[\s,]/g, "")) throw new Error("Invalid avatar path.");
  if (tokens[0] !== "M" || tokens.at(-1) !== "Z") throw new Error("Avatar silhouettes must be closed.");
  const parameters: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, Z: 0 };
  let segments = 0;
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i++];
    if (!(command in parameters) || (command === "M" && i !== 1) || (command === "Z" && i !== tokens.length)) {
      throw new Error("Invalid avatar path command.");
    }
    const count = parameters[command];
    for (let n = 0; n < count; n++) {
      if (i >= tokens.length || tokens[i] in parameters) throw new Error("Incomplete avatar path.");
      number(Number(tokens[i++]), 0, 100);
    }
    if (command !== "M" && command !== "Z") segments++;
  }
  if (segments < 2) throw new Error("Avatar silhouette is empty.");
  return tokens.join(" ");
}

// Used at both API boundaries. Return only fields the React SVG renderer understands.
export function parseAvatarDesign(value: unknown): AvatarDesign {
  const input = record(value);
  const bodyPath = parseBodyPath(input.bodyPath);
  if (typeof input.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(input.color)) throw new Error("Invalid avatar color.");
  if (!Array.isArray(input.eyes) || input.eyes.length !== 2) throw new Error("Provide two avatar eyes.");
  const eyes = input.eyes.map((value): AvatarEye => {
    const eye = record(value);
    const rx = number(eye.rx, 2, 9);
    const ry = number(eye.ry, 3, 10);
    return { cx: number(eye.cx, rx + 4, 96 - rx), cy: number(eye.cy, ry + 3, 97 - ry), rx, ry };
  }) as [AvatarEye, AvatarEye];
  if (eyes[1].cx - eyes[0].cx < eyes[0].rx + eyes[1].rx + 2) throw new Error("Avatar eyes must be separate.");
  return { bodyPath, color: input.color, eyes };
}

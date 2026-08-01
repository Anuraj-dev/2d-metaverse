/**
 * The bird: layered vector art (tail, far wing, body, near wing, eye, beak)
 * drawn around the state's position and rotation. `wing` is the renderer-side
 * flap animation phase — cosmetic only, it never feeds back into the rules.
 */
import type { FlappyState } from "../../../game/arcade/flappy";

/** Body radii (design units, before BIRD_SCALE). */
const BW = 25;
const BH = 19;
/**
 * Uniform shrink applied to the whole vector bird. It matches the ratio the
 * collision radius was reduced by (DEFAULT_FLAPPY_CONFIG.birdRadius 20 → 17),
 * so the drawn bird keeps exactly its old size relative to the hitbox — and
 * because it scales the vector path (not a bitmap), the art stays crisp.
 */
const BIRD_SCALE = 0.85;

export function drawBird(
  ctx: CanvasRenderingContext2D,
  state: FlappyState,
  wing: number
): void {
  const wingAngle = Math.sin(wing) * 0.95;

  ctx.save();
  ctx.translate(state.birdX, state.birdY);
  ctx.rotate(state.rot);

  // Ground shadow (kept level with the world, not the bird — and pinned to the
  // real ground, so only its size follows BIRD_SCALE).
  ctx.save();
  ctx.rotate(-state.rot);
  ctx.fillStyle = "rgba(0,0,0,0.13)";
  ctx.beginPath();
  ctx.ellipse(
    0,
    state.groundY - state.birdY - 6,
    22 * BIRD_SCALE,
    5 * BIRD_SCALE,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.restore();

  // Everything below is authored in design units; one scale shrinks the bird.
  ctx.scale(BIRD_SCALE, BIRD_SCALE);

  // Tail feathers.
  ctx.fillStyle = "#e8a52a";
  ctx.beginPath();
  ctx.moveTo(-14, -6);
  ctx.lineTo(-32, -13);
  ctx.lineTo(-28, -1);
  ctx.lineTo(-33, 8);
  ctx.lineTo(-14, 8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(120,72,10,0.55)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Far wing, behind the body.
  ctx.save();
  ctx.translate(-3, 1);
  ctx.rotate(wingAngle * 0.7 + 0.25);
  ctx.fillStyle = "#c9821c";
  ctx.beginPath();
  ctx.ellipse(-9, 4, 15, 8, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Body.
  const body = ctx.createRadialGradient(-6, -8, 3, 0, 2, 30);
  body.addColorStop(0, "#ffe98a");
  body.addColorStop(0.42, "#fdd53f");
  body.addColorStop(0.78, "#f5b91c");
  body.addColorStop(1, "#e09a11");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 0, BW, BH, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,252,225,0.85)"; // belly
  ctx.beginPath();
  ctx.ellipse(1, 8, 16, 8.5, 0.06, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.22)"; // head cap sheen
  ctx.beginPath();
  ctx.ellipse(-4, -9, 15, 6.5, -0.22, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#8a5405";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, BW, BH, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Near wing, in front of the body.
  ctx.save();
  ctx.translate(-4, -1);
  ctx.rotate(wingAngle);
  const feather = ctx.createLinearGradient(-20, -6, 4, 12);
  feather.addColorStop(0, "#fff6cf");
  feather.addColorStop(0.5, "#ffe07a");
  feather.addColorStop(1, "#e8a52a");
  ctx.fillStyle = feather;
  ctx.beginPath();
  ctx.moveTo(4, -3);
  ctx.quadraticCurveTo(-6, -14, -20, -8);
  ctx.quadraticCurveTo(-27, -3, -19, 7);
  ctx.quadraticCurveTo(-8, 14, 4, 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#8a5405";
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.strokeStyle = "rgba(138,84,5,0.4)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-3, 1);
  ctx.quadraticCurveTo(-11, 2, -17, 4);
  ctx.moveTo(-2, -4);
  ctx.quadraticCurveTo(-10, -5, -16, -5);
  ctx.stroke();
  ctx.restore();

  // Eye.
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(11, -6, 8.4, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#8a5405";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = "#221a10";
  ctx.beginPath();
  ctx.arc(13.6, -5.4, 4.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(15.2, -7.2, 1.6, 0, Math.PI * 2);
  ctx.fill();

  // Brow.
  ctx.strokeStyle = "rgba(138,84,5,0.75)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(5, -14);
  ctx.quadraticCurveTo(12, -17.5, 18, -13.5);
  ctx.stroke();

  // Beak.
  ctx.fillStyle = "#f77f28";
  ctx.beginPath();
  ctx.moveTo(18, -2.5);
  ctx.lineTo(35, 0.5);
  ctx.lineTo(18, 4.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#a44a08";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#d8611a";
  ctx.beginPath();
  ctx.moveTo(18, 3.6);
  ctx.lineTo(32.4, 1.4);
  ctx.lineTo(18, 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Cheek blush.
  ctx.fillStyle = "rgba(240,120,90,0.35)";
  ctx.beginPath();
  ctx.ellipse(6, 4, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

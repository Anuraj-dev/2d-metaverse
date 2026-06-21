import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

export interface AuthUser {
  id: string;
  username: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}

export function issueToken(user: AuthUser): string {
  return jwt.sign(
    { username: user.username },
    config.JWT_SECRET,
    { subject: user.id, expiresIn: config.JWT_TTL } as SignOptions
  );
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    if (typeof payload.sub !== "string" || typeof payload.username !== "string") return null;
    return { id: payload.sub, username: payload.username };
  } catch {
    return null;
  }
}

export function requireAuth(request: Request, response: Response, next: NextFunction): void {
  const header = request.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const user = verifyToken(token);
  if (!user) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  (request as AuthenticatedRequest).user = user;
  next();
}

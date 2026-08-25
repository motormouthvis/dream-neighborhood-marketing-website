"use strict";

const crypto = require("crypto");
const config = require("./config");

const COOKIE = "dnlv_session";

function sign(payload) {
  return crypto.createHmac("sha256", config.cookieSecret).update(payload).digest("hex");
}

function issueSession() {
  const expiresAt = Date.now() + config.sessionHours * 3600 * 1000;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

function verifySession(value) {
  if (!value || typeof value !== "string") return false;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;
  const expected = sign(payload);
  if (signature.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  return Number(payload) > Date.now();
}

function checkToken(candidate) {
  const provided = Buffer.from(String(candidate || ""));
  const expected = Buffer.from(config.accessToken);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

function isSignedIn(req) {
  return verifySession(req.cookies && req.cookies[COOKIE]);
}

function requireSession(req, res, next) {
  if (isSignedIn(req)) return next();
  return res.status(401).json({ error: "Please sign in again." });
}

module.exports = { COOKIE, issueSession, checkToken, isSignedIn, requireSession };

"use strict";

const nodemailer = require("nodemailer");
const config = require("./config");
const { VIDEO_TYPES } = require("./scripts");

function mailStatus() {
  if (!config.smtp.host) {
    return {
      connected: false,
      reason: "Mailbox not connected. No SMTP server is set on this server, so this tool cannot send email yet.",
    };
  }
  if (!config.smtp.user || !config.smtp.pass) {
    return {
      connected: false,
      reason: `Mailbox not connected. ${config.smtp.host} is set, but the mailbox user and password are missing.`,
    };
  }
  return { connected: true, reason: "" };
}

function fromAddress(fromId) {
  return config.fromAddresses.find((entry) => entry.id === fromId) || config.fromAddresses[0];
}

function buildEmail({ job, watchUrl }) {
  const firstName = job.input.firstName || "there";
  const company = job.input.company || "your website";
  const bothProducts = job.input.videoType === VIDEO_TYPES.SCHOOL_AND_NEIGHBORHOOD;

  const subject = `${firstName}, I made you a short video about the ${company} website`;

  const lines = [
    `Hi ${firstName},`,
    "",
    `I put together a short video using a real listing from the ${company} website. It shows School Explorer sitting on your own page: one line of code, it auto-detects the address, and we install it for you free.`,
    "",
    `Watch it here: ${watchUrl}`,
    "",
    "School Explorer is free for life, no credit card.",
  ];
  if (bothProducts) {
    lines.push("", "If you ever want more, Neighborhood Explorer is an upgrade on the same button.");
  }
  lines.push("", "If it looks useful, give us a call and we will get it on your site.", "", "— Dream Neighborhood");

  const text = lines.join("\n");
  const html = `
    <div style="font-family:Inter,Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#16202b">
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>I put together a short video using a real listing from the ${escapeHtml(company)} website. It shows
      School Explorer sitting on your own page: one line of code, it auto-detects the address, and we install it
      for you free.</p>
      <p><a href="${escapeHtml(watchUrl)}"
        style="display:inline-block;background:#1f7a4d;color:#fff;text-decoration:none;padding:13px 24px;border-radius:10px;font-weight:700">
        Watch the video</a></p>
      <p style="font-size:14px;color:#5b6b7b">${escapeHtml(watchUrl)}</p>
      <p>School Explorer is <strong>free for life, no credit card</strong>.</p>
      ${bothProducts ? "<p>If you ever want more, Neighborhood Explorer is an upgrade on the same button.</p>" : ""}
      <p>If it looks useful, give us a call and we will get it on your site.</p>
      <p>— Dream Neighborhood</p>
    </div>`;

  return { subject, text, html };
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );
}

async function sendVideoEmail({ job, fromId, watchUrl, to }) {
  const status = mailStatus();
  if (!status.connected) {
    const error = new Error(status.reason);
    error.code = "MAIL_NOT_CONNECTED";
    throw error;
  }

  const from = fromAddress(fromId);
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });

  const message = buildEmail({ job, watchUrl });
  const info = await transporter.sendMail({
    from: `Dream Neighborhood <${from.email}>`,
    replyTo: from.email,
    to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  return { messageId: info.messageId, accepted: info.accepted || [], from: from.email };
}

module.exports = { mailStatus, buildEmail, sendVideoEmail, fromAddress };

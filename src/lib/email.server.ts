import nodemailer from "nodemailer";

type AuthEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

let transport: ReturnType<typeof nodemailer.createTransport> | undefined;

function smtpPort() {
  const parsed = Number(process.env.SMTP_PORT);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : 587;
}

export function emailDeliveryConfigured() {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim());
}

function getTransport() {
  if (transport) return transport;
  const host = process.env.SMTP_HOST?.trim();
  if (!host) throw new Error("Email delivery is not configured");
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD;
  if (Boolean(user) !== Boolean(pass)) {
    throw new Error("SMTP_USER and SMTP_PASSWORD must be configured together");
  }
  const port = smtpPort();
  transport = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    requireTLS: process.env.SMTP_REQUIRE_TLS !== "false" && port !== 465,
    auth: user && pass ? { user, pass } : undefined,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return transport;
}

function safeAddress(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || /[\r\n]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid email address");
  }
  return email;
}

export async function sendAuthEmail(message: AuthEmail) {
  const from = process.env.SMTP_FROM?.trim();
  if (!from || /[\r\n]/.test(from)) throw new Error("SMTP_FROM is not configured");
  await getTransport().sendMail({
    from,
    to: safeAddress(message.to),
    subject: message.subject.replace(/[\r\n]+/g, " ").slice(0, 160),
    text: message.text,
    html: message.html,
  });
}

export function authLinkEmail(input: {
  kind: "verify" | "reset" | "change-email";
  to: string;
  url: string;
}) {
  const labels = {
    verify: {
      subject: "Verify your COACH email",
      heading: "Verify your email",
      body: "Confirm this email address to finish securing your COACH account.",
      action: "Verify email",
    },
    reset: {
      subject: "Reset your COACH password",
      heading: "Reset your password",
      body: "Use this secure link to choose a new COACH password. If you did not request this, ignore this email.",
      action: "Reset password",
    },
    "change-email": {
      subject: "Confirm your new COACH email",
      heading: "Confirm your new email",
      body: "Confirm this address to update the email used by your COACH account.",
      action: "Confirm email",
    },
  } as const;
  const copy = labels[input.kind];
  const safeUrl = input.url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return sendAuthEmail({
    to: input.to,
    subject: copy.subject,
    text: `${copy.body}\n\n${input.url}\n\nThis link expires automatically.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111"><h1>${copy.heading}</h1><p>${copy.body}</p><p><a href="${safeUrl}" style="display:inline-block;background:#ff1838;color:#fff;padding:12px 18px;text-decoration:none;font-weight:700">${copy.action}</a></p><p style="font-size:12px;color:#666">This link expires automatically.</p></div>`,
  });
}

import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

let transport = null;
function getTransport() {
    if (!env.SMTP_HOST) return null;
    transport ??= nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
        pool: true,
        maxConnections: 2,
        connectionTimeout: 10_000,
        socketTimeout: 20_000,
    });
    return transport;
}

const FROM = () => env.MAIL_FROM || `"Monowara Hospital Website" <${env.SMTP_USER}>`;

// Header-injection guard: no CR/LF in anything that ends up in a header.
const oneLine = (s) => String(s ?? "").replace(/[\r\n]+/g, " ").slice(0, 200);

/**
 * Plain-text mail only (no HTML → nothing user-typed can inject markup). Never throws: a mail
 * failure must not fail the form submission that triggered it — it is logged instead.
 */
export async function sendMail({ to, subject, text, replyTo }) {
    const t = getTransport();
    const recipients = [].concat(to).filter(Boolean);
    if (!t || !recipients.length) {
        logger.warn({ subject }, "Mail skipped (SMTP_HOST or recipients not configured)");
        return false;
    }
    try {
        await t.sendMail({
            from: FROM(),
            to: recipients,
            subject: oneLine(subject),
            text,
            ...(replyTo && /^[^\s@]+@[^\s@]+$/.test(replyTo) && { replyTo: oneLine(replyTo) }),
        });
        return true;
    } catch (err) {
        logger.error({ err: err.message, subject }, "Mail send failed");
        return false;
    }
}

/** Fire-and-forget staff alert (doesn't delay the HTTP response). */
export function alertStaff(subject, lines, { replyTo, path } = {}) {
    const link = env.ADMIN_URL && path ? `\n\nOpen in the dashboard: ${env.ADMIN_URL.replace(/\/$/, "")}${path}` : "";
    const text = `${lines.filter((l) => l != null && l !== "").join("\n")}${link}\n\n— monowarahospital.com`;
    void sendMail({ to: env.ADMIN_EMAIL, subject, text, replyTo });
}

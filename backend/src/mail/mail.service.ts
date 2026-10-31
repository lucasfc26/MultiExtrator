import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common'
import nodemailer, { type Transporter } from 'nodemailer'
import { ENV, type Env } from '../config/env'

/**
 * Envio de e-mail por SMTP. No dev o destino é o Mailpit
 * (http://localhost:8025 mostra as mensagens). Falha de envio não derruba a
 * operação: é registrada no log.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)
  private readonly transport: Transporter

  constructor(@Inject(ENV) private readonly env: Env) {
    this.transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  }

  async send(to: string, subject: string, text: string, attachments?: { filename: string; content: string }[]) {
    try {
      await this.transport.sendMail({
        from: this.env.MAIL_FROM,
        to,
        subject,
        text,
        html: layout(subject, text),
        attachments,
      })
      return true
    } catch (e) {
      this.logger.warn(`Falha ao enviar "${subject}": ${(e as Error).message}`)
      return false
    }
  }

  link(path: string) {
    return `${this.env.APP_URL.replace(/\/$/, '')}${path}`
  }
}

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

function layout(title: string, text: string) {
  const body = escape(text)
    .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color:#EA580C">$1</a>')
    .replace(/\n/g, '<br>')
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#f4f6f9;padding:24px">
<div style="max-width:520px;margin:auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e7eb">
<p style="font-weight:600;color:#EA580C;margin:0 0 16px">Fatturas</p>
<h1 style="font-size:18px;margin:0 0 12px;color:#0f172a">${escape(title)}</h1>
<p style="color:#334155;line-height:1.6;margin:0">${body}</p>
</div></body></html>`
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}

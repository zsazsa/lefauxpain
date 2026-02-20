package email

import (
	"crypto/tls"
	"fmt"
	"net/smtp"
	"strings"
)

type SMTPProvider struct {
	Host       string
	Port       int
	Username   string
	Password   string
	Encryption string // "none", "tls", "starttls"
	FromEmail  string
	FromName   string
}

func (p *SMTPProvider) sendEmail(to, subject, htmlBody, textBody string) error {
	addr := fmt.Sprintf("%s:%d", p.Host, p.Port)
	from := p.FromEmail
	if p.FromName != "" {
		from = fmt.Sprintf("%s <%s>", p.FromName, p.FromEmail)
	}

	msg := buildMIMEMessage(from, to, subject, htmlBody, textBody)

	var client *smtp.Client
	var err error

	switch strings.ToLower(p.Encryption) {
	case "tls":
		tlsConn, dialErr := tls.Dial("tcp", addr, &tls.Config{ServerName: p.Host})
		if dialErr != nil {
			return fmt.Errorf("TLS dial %s: %w", addr, dialErr)
		}
		client, err = smtp.NewClient(tlsConn, p.Host)
		if err != nil {
			return fmt.Errorf("create SMTP client: %w", err)
		}
	case "starttls":
		client, err = smtp.Dial(addr)
		if err != nil {
			return fmt.Errorf("SMTP dial %s: %w", addr, err)
		}
		if err := client.StartTLS(&tls.Config{ServerName: p.Host}); err != nil {
			client.Close()
			return fmt.Errorf("STARTTLS: %w", err)
		}
	default: // "none"
		client, err = smtp.Dial(addr)
		if err != nil {
			return fmt.Errorf("SMTP dial %s: %w", addr, err)
		}
	}
	defer client.Close()

	if p.Username != "" {
		auth := smtp.PlainAuth("", p.Username, p.Password, p.Host)
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("Authentication failed: %w", err)
		}
	}

	if err := client.Mail(p.FromEmail); err != nil {
		return fmt.Errorf("MAIL FROM: %w", err)
	}
	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("RCPT TO: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("DATA: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("write message: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("close data: %w", err)
	}

	return client.Quit()
}

func (p *SMTPProvider) SendVerificationEmail(to, code, appName string) error {
	subject := fmt.Sprintf("%s — Verify your email", appName)
	return p.sendEmail(to, subject, VerificationEmailHTML(code, appName), VerificationEmailText(code, appName))
}

func (p *SMTPProvider) SendPasswordResetEmail(to, code, appName string) error {
	subject := fmt.Sprintf("%s — Reset your password", appName)
	return p.sendEmail(to, subject, PasswordResetEmailHTML(code, appName), PasswordResetEmailText(code, appName))
}

func (p *SMTPProvider) SendTestEmail(to, appName string) error {
	subject := fmt.Sprintf("%s — Test email", appName)
	return p.sendEmail(to, subject, TestEmailHTML(appName), TestEmailText(appName))
}

func buildMIMEMessage(from, to, subject, htmlBody, textBody string) []byte {
	boundary := "----=_MIMEBoundary_voicechat"
	var b strings.Builder
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("Subject: " + subject + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: multipart/alternative; boundary=\"" + boundary + "\"\r\n")
	b.WriteString("\r\n")

	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/plain; charset=\"utf-8\"\r\n")
	b.WriteString("\r\n")
	b.WriteString(textBody)
	b.WriteString("\r\n")

	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/html; charset=\"utf-8\"\r\n")
	b.WriteString("\r\n")
	b.WriteString(htmlBody)
	b.WriteString("\r\n")

	b.WriteString("--" + boundary + "--\r\n")
	return []byte(b.String())
}

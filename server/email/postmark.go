package email

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
)

type PostmarkProvider struct {
	APIKey    string
	FromEmail string
	FromName  string
}

func (p *PostmarkProvider) SendVerificationEmail(to, code, appName string) error {
	from := p.FromEmail
	if p.FromName != "" {
		from = fmt.Sprintf("%s <%s>", p.FromName, p.FromEmail)
	}

	payload := map[string]string{
		"From":     from,
		"To":       to,
		"Subject":  fmt.Sprintf("%s — Verify your email", appName),
		"HtmlBody": VerificationEmailHTML(code, appName),
		"TextBody": VerificationEmailText(code, appName),
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal postmark payload: %w", err)
	}

	req, err := http.NewRequest("POST", "https://api.postmarkapp.com/email", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create postmark request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Postmark-Server-Token", p.APIKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("postmark request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("postmark returned status %d", resp.StatusCode)
	}

	return nil
}

func (p *PostmarkProvider) SendPasswordResetEmail(to, code, appName string) error {
	from := p.FromEmail
	if p.FromName != "" {
		from = fmt.Sprintf("%s <%s>", p.FromName, p.FromEmail)
	}

	payload := map[string]string{
		"From":     from,
		"To":       to,
		"Subject":  fmt.Sprintf("%s — Reset your password", appName),
		"HtmlBody": PasswordResetEmailHTML(code, appName),
		"TextBody": PasswordResetEmailText(code, appName),
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal postmark payload: %w", err)
	}

	req, err := http.NewRequest("POST", "https://api.postmarkapp.com/email", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create postmark request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Postmark-Server-Token", p.APIKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("postmark request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("postmark returned status %d", resp.StatusCode)
	}

	return nil
}

func (p *PostmarkProvider) SendTestEmail(to, appName string) error {
	from := p.FromEmail
	if p.FromName != "" {
		from = fmt.Sprintf("%s <%s>", p.FromName, p.FromEmail)
	}

	payload := map[string]string{
		"From":     from,
		"To":       to,
		"Subject":  fmt.Sprintf("%s — Test email", appName),
		"HtmlBody": TestEmailHTML(appName),
		"TextBody": TestEmailText(appName),
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal postmark payload: %w", err)
	}

	req, err := http.NewRequest("POST", "https://api.postmarkapp.com/email", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create postmark request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Postmark-Server-Token", p.APIKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("postmark request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("postmark returned status %d", resp.StatusCode)
	}

	return nil
}

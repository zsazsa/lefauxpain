package email

import "fmt"

func VerificationEmailHTML(code, appName string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
  <h2>%s</h2>
  <p>Your verification code is:</p>
  <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; text-align: center; padding: 16px; background: #f4f4f4; border-radius: 8px;">%s</p>
  <p>This code expires in 15 minutes.</p>
  <p style="color: #888; font-size: 12px;">If you didn't create an account, you can ignore this email.</p>
</body>
</html>`, appName, code)
}

func VerificationEmailText(code, appName string) string {
	return fmt.Sprintf(`%s

Your verification code is: %s

This code expires in 15 minutes.

If you didn't create an account, you can ignore this email.`, appName, code)
}

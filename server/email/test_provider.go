package email

type TestProvider struct{}

func (p *TestProvider) SendVerificationEmail(to, code, appName string) error {
	return nil
}

func (p *TestProvider) SendPasswordResetEmail(to, code, appName string) error {
	return nil
}

func (p *TestProvider) SendTestEmail(to, appName string) error {
	return nil
}

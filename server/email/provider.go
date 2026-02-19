package email

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kalman/voicechat/crypto"
	"github.com/kalman/voicechat/db"
	"golang.org/x/crypto/bcrypt"
)

type Provider interface {
	SendVerificationEmail(to, code, appName string) error
	SendTestEmail(to, appName string) error
}

type ProviderConfig struct {
	Provider   string `json:"provider"`
	APIKey     string `json:"api_key,omitempty"`
	FromEmail  string `json:"from_email"`
	FromName   string `json:"from_name"`
	Host       string `json:"host,omitempty"`
	Port       int    `json:"port,omitempty"`
	Username   string `json:"username,omitempty"`
	Password   string `json:"password,omitempty"`
	Encryption string `json:"encryption,omitempty"`
}

type EmailService struct {
	mu      sync.RWMutex
	codes   map[string]string // email -> latest plain code (for dev test endpoint)
	db      *db.DB
	encKey  []byte
	devMode bool
}

func NewEmailService(database *db.DB, encKey []byte, devMode bool) *EmailService {
	return &EmailService{
		codes:   make(map[string]string),
		db:      database,
		encKey:  encKey,
		devMode: devMode,
	}
}

func (s *EmailService) GetProvider() (Provider, error) {
	encrypted, err := s.db.GetSetting("email_provider_config")
	if err != nil {
		return nil, fmt.Errorf("get provider config: %w", err)
	}
	if encrypted == "" {
		return nil, fmt.Errorf("no email provider configured")
	}

	decrypted, err := crypto.Decrypt(s.encKey, encrypted)
	if err != nil {
		return nil, fmt.Errorf("decrypt provider config: %w", err)
	}

	var cfg ProviderConfig
	if err := json.Unmarshal([]byte(decrypted), &cfg); err != nil {
		return nil, fmt.Errorf("parse provider config: %w", err)
	}

	switch cfg.Provider {
	case "postmark":
		return &PostmarkProvider{
			APIKey:    cfg.APIKey,
			FromEmail: cfg.FromEmail,
			FromName:  cfg.FromName,
		}, nil
	case "smtp":
		return &SMTPProvider{
			Host:       cfg.Host,
			Port:       cfg.Port,
			Username:   cfg.Username,
			Password:   cfg.Password,
			Encryption: cfg.Encryption,
			FromEmail:  cfg.FromEmail,
			FromName:   cfg.FromName,
		}, nil
	case "test":
		return &TestProvider{}, nil
	default:
		return nil, fmt.Errorf("unknown email provider: %s", cfg.Provider)
	}
}

func (s *EmailService) GenerateAndSendCode(userID, email string) error {
	code, err := generateCode()
	if err != nil {
		return fmt.Errorf("generate code: %w", err)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash code: %w", err)
	}

	codeID := uuid.New().String()
	expiresAt := time.Now().Add(15 * time.Minute)

	if err := s.db.CreateVerificationCode(codeID, userID, string(hash), expiresAt); err != nil {
		return fmt.Errorf("store verification code: %w", err)
	}

	// Store plain code in memory for dev test endpoint
	s.mu.Lock()
	s.codes[email] = code
	s.mu.Unlock()

	provider, err := s.GetProvider()
	if err != nil {
		log.Printf("email provider error (code still stored): %v", err)
		return nil // user created, code stored — provider failure is non-fatal
	}

	if err := provider.SendVerificationEmail(email, code, "Le Faux Pain"); err != nil {
		log.Printf("send verification email error: %v", err)
		// Non-fatal — user can resend
	}

	return nil
}

func (s *EmailService) GetTestCode(email string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.codes[email]
}

func (s *EmailService) IsVerificationEnabled() (bool, error) {
	val, err := s.db.GetSetting("email_verification_enabled")
	if err != nil {
		return false, err
	}
	return val == "true", nil
}

func (s *EmailService) GetProviderConfig() (*ProviderConfig, error) {
	encrypted, err := s.db.GetSetting("email_provider_config")
	if err != nil {
		return nil, fmt.Errorf("get provider config: %w", err)
	}
	if encrypted == "" {
		return nil, nil
	}

	decrypted, err := crypto.Decrypt(s.encKey, encrypted)
	if err != nil {
		return nil, fmt.Errorf("decrypt provider config: %w", err)
	}

	var cfg ProviderConfig
	if err := json.Unmarshal([]byte(decrypted), &cfg); err != nil {
		return nil, fmt.Errorf("parse provider config: %w", err)
	}
	return &cfg, nil
}

func (s *EmailService) SendTestEmail(to, appName string) error {
	provider, err := s.GetProvider()
	if err != nil {
		return err
	}
	return provider.SendTestEmail(to, appName)
}

func generateCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

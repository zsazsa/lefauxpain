package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/kalman/voicechat/db"
)

type contextKey string

const userContextKey contextKey = "user"

type AuthMiddleware struct {
	DB *db.DB
}

func (m *AuthMiddleware) Wrap(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			writeError(w, http.StatusUnauthorized, "missing or invalid authorization header")
			return
		}

		token := strings.TrimPrefix(auth, "Bearer ")
		user, err := m.DB.GetUserByToken(token)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if user == nil {
			writeError(w, http.StatusUnauthorized, "invalid token")
			return
		}

		if !user.Approved {
			writeError(w, http.StatusForbidden, "account pending approval")
			return
		}

		ctx := context.WithValue(r.Context(), userContextKey, user)
		next(w, r.WithContext(ctx))
	}
}

func UserFromContext(ctx context.Context) *db.User {
	u, _ := ctx.Value(userContextKey).(*db.User)
	return u
}

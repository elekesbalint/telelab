package store

import (
	"context"
	"os"
	"testing"
	"time"
)

// Runs only with a database: TELELAB_TEST_DSN=postgres://... go test ./internal/store
func TestLoginRolesAndPorts(t *testing.T) {
	dsn := os.Getenv("TELELAB_TEST_DSN")
	if dsn == "" {
		t.Skip("TELELAB_TEST_DSN not set")
	}
	ctx := context.Background()
	st, err := Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	st.DB().ExecContext(ctx, `DELETE FROM users`)
	ports := []int{31600, 31601}

	owner, err := st.LoginDiscordUser(ctx, "1", "balint", "Bálint", "", false, ports)
	if err != nil || owner.Role != RoleOwner || owner.UDPPort == nil || *owner.UDPPort != 31600 {
		t.Fatalf("first user: %+v %v", owner, err)
	}
	member, _ := st.LoginDiscordUser(ctx, "2", "mate", "Máté", "", true, ports)
	if member.Role != RoleDriver || member.UDPPort == nil || *member.UDPPort != 31601 {
		t.Fatalf("guild member: %+v", member)
	}
	stranger, _ := st.LoginDiscordUser(ctx, "3", "x", "", "", false, ports)
	if stranger.Role != RolePending || stranger.UDPPort != nil {
		t.Fatalf("stranger: %+v", stranger)
	}
	// approving when no port is free leaves the user without a port
	again, _ := st.LoginDiscordUser(ctx, "3", "x", "", "", true, ports)
	if again.Role != RoleDriver || again.UDPPort != nil {
		t.Fatalf("approved without free port: %+v", again)
	}
	// port conflicts are reported
	p := 31600
	if _, err := st.UpdateUser(ctx, again.ID, RoleDriver, &p); err != ErrPortTaken {
		t.Fatalf("want ErrPortTaken, got %v", err)
	}

	tok, err := st.CreateLoginSession(ctx, owner.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	u, err := st.UserBySession(ctx, tok)
	if err != nil || u.ID != owner.ID {
		t.Fatalf("session lookup: %+v %v", u, err)
	}
	st.DeleteLoginSession(ctx, tok)
	if _, err := st.UserBySession(ctx, tok); err == nil {
		t.Fatal("deleted session still valid")
	}
}

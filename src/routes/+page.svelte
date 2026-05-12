<svelte:head>
  <title>Flareshare — Sign in</title>
</svelte:head>

<div class="app">
  <main class="view view-auth">
    <div class="auth-card">
      <div class="auth-mark">
        <span class="wm-dot big"></span>
        <span class="auth-wm">Flareshare</span>
      </div>
      <h2 class="auth-title">A quieter way to send files.</h2>
      <p class="auth-sub">
        Personal, self-hosted on Cloudflare R2.<br />
        Sign in to start a transfer.
      </p>

      <a
        class="btn btn-primary btn-big"
        href="/auth/login"
      >
        <span
          class="gh"
          aria-hidden="true"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path
              d="M8 0C3.58 0 0 3.58 0 8a8 8 0 005.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"
            />
          </svg>
        </span>
        Continue with GitHub
      </a>
    </div>
  </main>
</div>

<style>
  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--ink);
  }

  .wm-dot {
    width: 9px;
    height: 9px;
    background: var(--ink);
    border-radius: 50%;
    display: inline-block;
  }
  .wm-dot.big {
    width: 14px;
    height: 14px;
  }

  .view {
    max-width: 1180px;
    margin: 0 auto;
    padding: 64px 32px 96px;
    width: 100%;
    flex: 1;
  }
  .view-auth {
    display: flex;
    align-items: center;
    justify-content: center;
    padding-bottom: 96px;
    padding-top: 0px;
  }
  .auth-card {
    width: 100%;
    max-width: 380px;
    text-align: left;
    padding: 24px 0;
  }
  .auth-mark {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 48px;
  }
  .auth-wm {
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .auth-title {
    font-size: 32px;
    line-height: 1.05;
    letter-spacing: -0.035em;
    font-weight: 500;
    color: var(--ink);
    margin-bottom: 14px;
    text-wrap: balance;
  }
  .auth-sub {
    color: var(--muted);
    font-size: 14px;
    margin-bottom: 32px;
    line-height: 1.5;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 13.5px;
    font-weight: 500;
    letter-spacing: -0.005em;
    padding: 10px 16px;
    border-radius: 2px;
    transition:
      transform 0.06s,
      background 0.15s,
      color 0.15s,
      border-color 0.15s;
    border: 1px solid transparent;
    white-space: nowrap;
  }
  .btn:active {
    transform: translateY(0.5px);
  }
  .btn-primary {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }
  .btn-primary:hover {
    background: color-mix(in srgb, var(--accent) 88%, black);
  }
  .btn-big {
    padding: 14px 22px;
    font-size: 14px;
    width: 100%;
  }
  .gh {
    display: inline-flex;
    align-items: center;
  }

  @media (max-width: 760px) {
    .view {
      padding: 32px 18px 64px;
    }
  }
</style>

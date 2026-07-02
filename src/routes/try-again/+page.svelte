<svelte:head>
  <title>Flareshare — Try again</title>
</svelte:head>

<div class="app">
  <main class="view view-auth">
    <div class="auth-card">
      <div class="auth-mark">
        <span class="wm-dot big"></span>
        <span class="auth-wm">Flareshare</span>
      </div>
      <h2 class="auth-title">Something went wrong.</h2>
      <p class="auth-sub">
        There was a temporary problem loading this transfer.<br />
        Please try again in a moment.
      </p>

      <a
        class="btn btn-primary btn-big"
        href=".">Try again</a
      >
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

  @media (max-width: 760px) {
    .view {
      padding: 32px 18px 64px;
    }
  }
</style>
